import { createHash, randomUUID } from "node:crypto";
import { loadServerEnv } from "../env";
import { decryptSecret, encryptSecret } from "./crypto";
import { previousDays, nextIncrementalRange } from "./date";
import { integrationStore } from "./store";
import type { ExternalProperty, IntegrationAdapter, IntegrationConnection, IntegrationProvider, MetricRow, OAuthTokenSet } from "./types";

const API_TIMEOUT_MS = 15000;
const GA4_MAX_METRICS_PER_REQUEST = 10;

function assertEnv(keys: string[]) {
  loadServerEnv();
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing integration environment variables: ${missing.join(", ")}`);
}

async function jsonFetch<T>(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { accept: "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(API_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({})) as T & { error?: unknown; error_description?: unknown };
  if (!response.ok) {
    throw new Error(providerApiErrorMessage(response.status, data));
  }
  return data;
}

function providerApiErrorMessage(status: number, data: { error?: unknown; error_description?: unknown }) {
  const googleError = googleApiError(data.error);
  if (googleError?.reason === "SERVICE_DISABLED" && googleError.serviceTitle) {
    const action = googleError.activationUrl ? ` Enable it here, then retry after a few minutes: ${googleError.activationUrl}` : " Enable it in Google Cloud, then retry after a few minutes.";
    return `${googleError.serviceTitle} is disabled for this Google Cloud project.${action}`;
  }
  const message = googleError?.message ?? stringValue(data.error_description) ?? stringValue(data.error);
  return message ? `Provider API request failed (${status}): ${message}` : `Provider API request failed (${status}).`;
}

function googleApiError(error: unknown) {
  if (!isRecord(error)) return null;
  const details = Array.isArray(error.details) ? error.details : [];
  const errorInfo = details.find((detail): detail is Record<string, unknown> => isRecord(detail) && detail["@type"] === "type.googleapis.com/google.rpc.ErrorInfo");
  const metadata = isRecord(errorInfo?.metadata) ? errorInfo.metadata : {};
  return {
    message: stringValue(error.message),
    reason: stringValue(errorInfo?.reason),
    serviceTitle: stringValue(metadata.serviceTitle),
    activationUrl: details
      .filter(isRecord)
      .flatMap((detail) => Array.isArray(detail.links) ? detail.links : [])
      .find((link): link is Record<string, unknown> => isRecord(link) && Boolean(link.url))
      ?.url as string | undefined
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

async function tokenRequest(url: string, body: URLSearchParams) {
  return jsonFetch<Record<string, unknown>>(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
}

function expiresAt(expiresIn: unknown) {
  return new Date(Date.now() + Math.max(60, Number(expiresIn ?? 3600) - 60) * 1000).toISOString();
}

function metricId(row: Omit<MetricRow, "id">) {
  return createHash("sha256")
    .update([row.userId, row.projectId, row.provider, row.propertyId, row.date, row.dimensionType, row.dimensionValue].join("|"))
    .digest("hex");
}

function row(input: Omit<MetricRow, "id" | "createdAt" | "updatedAt">): MetricRow {
  const now = new Date().toISOString();
  return { ...input, id: metricId({ ...input, createdAt: now, updatedAt: now }), createdAt: now, updatedAt: now };
}

function encryptedConnectionTokens(connection: IntegrationConnection) {
  return {
    accessToken: decryptSecret(connection.encryptedAccessToken),
    refreshToken: connection.encryptedRefreshToken ? decryptSecret(connection.encryptedRefreshToken) : undefined
  };
}

async function userinfo(accessToken: string) {
  return jsonFetch<{ email?: string; sub?: string }>("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` }
  }).catch((): { email?: string; sub?: string } => ({}));
}

abstract class GoogleAdapter implements IntegrationAdapter {
  abstract provider: IntegrationProvider;
  abstract scopes: string[];
  abstract listProperties(connection: IntegrationConnection): Promise<ExternalProperty[]>;
  abstract validatePropertyAccess(connection: IntegrationConnection, propertyId: string): Promise<boolean>;
  abstract fetchInitialData(connection: IntegrationConnection): Promise<number>;
  abstract fetchIncrementalData(connection: IntegrationConnection): Promise<number>;
  abstract testConnection(connection: IntegrationConnection): Promise<{ ok: boolean; message: string }>;

  protected oauthConfig() {
    const redirectKey = this.provider === "GOOGLE_ANALYTICS"
      ? "GOOGLE_ANALYTICS_REDIRECT_URI"
      : "GOOGLE_SEARCH_CONSOLE_REDIRECT_URI";
    assertEnv(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", redirectKey]);
    return {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirectUri: process.env[redirectKey] ?? ""
    };
  }

  getAuthorizationUrl(input: { state: string; codeChallenge?: string }) {
    const { clientId, redirectUri } = this.oauthConfig();
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", ["openid", "email", ...this.scopes].join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", input.state);
    if (input.codeChallenge) {
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
    }
    return url.toString();
  }

  async handleOAuthCallback(code: string, codeVerifier?: string): Promise<OAuthTokenSet> {
    const { clientId, clientSecret, redirectUri } = this.oauthConfig();
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    });
    if (codeVerifier) body.set("code_verifier", codeVerifier);
    const tokens = await tokenRequest("https://oauth2.googleapis.com/token", body);
    const accessToken = String(tokens.access_token ?? "");
    if (!accessToken) throw new Error("Google did not return an access token.");
    const profile = await userinfo(accessToken);
    return {
      accessToken,
      refreshToken: tokens.refresh_token ? String(tokens.refresh_token) : undefined,
      expiresAt: expiresAt(tokens.expires_in),
      scopes: String(tokens.scope ?? this.scopes.join(" ")).split(/\s+/).filter(Boolean),
      accountEmail: profile.email,
      externalAccountId: profile.sub
    };
  }

  async refreshAccessToken(connection: IntegrationConnection): Promise<OAuthTokenSet> {
    const { refreshToken } = encryptedConnectionTokens(connection);
    if (!refreshToken) throw new Error("Missing refresh token. Reconnect this provider.");
    const { clientId, clientSecret } = this.oauthConfig();
    const tokens = await tokenRequest("https://oauth2.googleapis.com/token", new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token"
    }));
    const accessToken = String(tokens.access_token ?? "");
    if (!accessToken) throw new Error("Google refresh did not return an access token.");
    return {
      accessToken,
      refreshToken,
      expiresAt: expiresAt(tokens.expires_in),
      scopes: connection.scopes
    };
  }

  async disconnect() {}
}

class SearchConsoleAdapter extends GoogleAdapter {
  provider = "GOOGLE_SEARCH_CONSOLE" as const;
  scopes = ["https://www.googleapis.com/auth/webmasters.readonly"];

  async listProperties(connection: IntegrationConnection) {
    const { accessToken } = await freshTokens(this, connection);
    const data = await jsonFetch<{ siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> }>("https://www.googleapis.com/webmasters/v3/sites", {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    return (data.siteEntry ?? [])
      .filter((site) => site.permissionLevel && site.permissionLevel !== "siteUnverifiedUser")
      .map((site): ExternalProperty => ({ id: String(site.siteUrl ?? ""), name: String(site.siteUrl ?? ""), url: String(site.siteUrl ?? "") }))
      .filter((site) => site.id);
  }

  async validatePropertyAccess(connection: IntegrationConnection, propertyId: string) {
    return (await this.listProperties(connection)).some((property) => property.id === propertyId);
  }

  async fetchInitialData(connection: IntegrationConnection) {
    return fetchSearchConsoleRange(this, connection, previousDays(90));
  }

  async fetchIncrementalData(connection: IntegrationConnection) {
    return fetchSearchConsoleRange(this, connection, nextIncrementalRange(connection.lastSyncedAt));
  }

  async testConnection(connection: IntegrationConnection) {
    await this.listProperties(connection);
    return { ok: true, message: "Search Console access is valid." };
  }
}

async function fetchSearchConsoleRange(adapter: SearchConsoleAdapter, connection: IntegrationConnection, range: { startDate: string; endDate: string }) {
  if (!connection.externalPropertyId) throw new Error("Select a Search Console property before syncing.");
  const { accessToken } = await freshTokens(adapter, connection);
  const property = encodeURIComponent(connection.externalPropertyId);
  const dimensionGroups: Array<{ dimensionType: MetricRow["dimensionType"]; dimensions: string[] }> = [
    { dimensionType: "daily", dimensions: ["date"] },
    { dimensionType: "query", dimensions: ["date", "query"] },
    { dimensionType: "page", dimensions: ["date", "page"] },
    { dimensionType: "country", dimensions: ["date", "country"] },
    { dimensionType: "device", dimensions: ["date", "device"] }
  ];
  const rows: MetricRow[] = [];
  for (const group of dimensionGroups) {
    const data = await jsonFetch<{ rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }> }>(
      `https://www.googleapis.com/webmasters/v3/sites/${property}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ startDate: range.startDate, endDate: range.endDate, dimensions: group.dimensions, rowLimit: 25000 })
      }
    );
    for (const item of data.rows ?? []) {
      const keys = item.keys ?? [];
      const date = keys[0] ?? range.endDate;
      rows.push(row({
        userId: connection.userId,
        projectId: connection.projectId,
        provider: connection.provider,
        propertyId: connection.externalPropertyId,
        date,
        dimensionType: group.dimensionType,
        dimensionValue: group.dimensionType === "daily" ? "all" : String(keys[1] ?? "unknown"),
        metrics: {
          clicks: Number(item.clicks ?? 0),
          impressions: Number(item.impressions ?? 0),
          ctr: Number(item.ctr ?? 0),
          position: Number(item.position ?? 0)
        }
      }));
    }
  }
  return integrationStore.upsertMetricRows(rows);
}

class GoogleAnalyticsAdapter extends GoogleAdapter {
  provider = "GOOGLE_ANALYTICS" as const;
  scopes = ["https://www.googleapis.com/auth/analytics.readonly"];

  async listProperties(connection: IntegrationConnection) {
    const { accessToken } = await freshTokens(this, connection);
    const data = await jsonFetch<{ accountSummaries?: Array<{ account?: string; displayName?: string; propertySummaries?: Array<{ property?: string; displayName?: string }> }> }>(
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
      { headers: { authorization: `Bearer ${accessToken}` } }
    );
    return (data.accountSummaries ?? []).flatMap((account) =>
      (account.propertySummaries ?? []).map((property): ExternalProperty => ({
        id: String(property.property ?? ""),
        name: `${account.displayName ?? account.account ?? "GA4"} / ${property.displayName ?? property.property}`,
        accountId: account.account
      }))
    ).filter((property) => property.id);
  }

  async validatePropertyAccess(connection: IntegrationConnection, propertyId: string) {
    return (await this.listProperties(connection)).some((property) => property.id === propertyId);
  }

  async fetchInitialData(connection: IntegrationConnection) {
    return fetchGa4Range(this, connection, previousDays(90));
  }

  async fetchIncrementalData(connection: IntegrationConnection) {
    return fetchGa4Range(this, connection, nextIncrementalRange(connection.lastSyncedAt));
  }

  async testConnection(connection: IntegrationConnection) {
    await this.listProperties(connection);
    return { ok: true, message: "Google Analytics access is valid." };
  }
}

async function fetchGa4Range(adapter: GoogleAnalyticsAdapter, connection: IntegrationConnection, range: { startDate: string; endDate: string }) {
  if (!connection.externalPropertyId) throw new Error("Select a GA4 property before syncing.");
  const { accessToken } = await freshTokens(adapter, connection);
  const property = connection.externalPropertyId;
  const metricNames = [
    "activeUsers", "newUsers", "sessions", "engagedSessions", "engagementRate", "averageSessionDuration",
    "userEngagementDuration", "screenPageViews", "eventCount", "keyEvents", "sessionKeyEventRate"
  ];
  const dimensionGroups: Array<{ dimensionType: MetricRow["dimensionType"]; dimensions: string[] }> = [
    { dimensionType: "daily", dimensions: ["date"] },
    { dimensionType: "landing_page", dimensions: ["date", "landingPagePlusQueryString"] },
    { dimensionType: "traffic_source", dimensions: ["date", "sessionSource", "sessionMedium", "sessionDefaultChannelGroup"] },
    { dimensionType: "device", dimensions: ["date", "deviceCategory"] },
    { dimensionType: "geo", dimensions: ["date", "country", "city"] }
  ];
  const rows: MetricRow[] = [];
  for (const group of dimensionGroups) {
    const rowsByDimensions = new Map<string, { dimensions: string[]; metrics: Record<string, number> }>();
    for (const metricBatch of chunk(metricNames, GA4_MAX_METRICS_PER_REQUEST)) {
      const data = await jsonFetch<{
        rows?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>;
      }>(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          dateRanges: [range],
          dimensions: group.dimensions.map((name) => ({ name })),
          metrics: metricBatch.map((name) => ({ name })),
          limit: "25000"
        })
      });
      for (const item of data.rows ?? []) {
        const dimensions = (item.dimensionValues ?? []).map((value) => value.value ?? "");
        const key = JSON.stringify(dimensions);
        const existing = rowsByDimensions.get(key) ?? { dimensions, metrics: {} };
        metricBatch.forEach((name, index) => {
          existing.metrics[name] = Number(item.metricValues?.[index]?.value ?? 0);
        });
        rowsByDimensions.set(key, existing);
      }
    }
    for (const { dimensions, metrics } of rowsByDimensions.values()) {
      rows.push(row({
        userId: connection.userId,
        projectId: connection.projectId,
        provider: connection.provider,
        propertyId: property,
        date: normalizeGa4Date(dimensions[0] ?? range.endDate),
        dimensionType: group.dimensionType,
        dimensionValue: group.dimensionType === "daily" ? "all" : dimensions.slice(1).join(" / "),
        metrics
      }));
    }
  }
  return integrationStore.upsertMetricRows(rows);
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeGa4Date(value: string) {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;
}

class BingWebmasterAdapter implements IntegrationAdapter {
  provider = "BING_WEBMASTER" as const;
  scopes = ["offline_access", "https://ssl.bing.com/webmaster/Webmaster.Read"];

  private oauthConfig() {
    assertEnv(["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_INTEGRATIONS_REDIRECT_URI"]);
    return {
      clientId: process.env.MICROSOFT_CLIENT_ID ?? "",
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
      redirectUri: process.env.MICROSOFT_INTEGRATIONS_REDIRECT_URI ?? "",
      tenant: process.env.MICROSOFT_TENANT_ID ?? "common"
    };
  }

  getAuthorizationUrl(input: { state: string; codeChallenge?: string }) {
    const { clientId, redirectUri, tenant } = this.oauthConfig();
    const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.scopes.join(" "));
    url.searchParams.set("state", input.state);
    if (input.codeChallenge) {
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
    }
    return url.toString();
  }

  async handleOAuthCallback(code: string, codeVerifier?: string): Promise<OAuthTokenSet> {
    const { clientId, clientSecret, redirectUri, tenant } = this.oauthConfig();
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: this.scopes.join(" ")
    });
    if (codeVerifier) body.set("code_verifier", codeVerifier);
    const tokens = await tokenRequest(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, body);
    const accessToken = String(tokens.access_token ?? "");
    if (!accessToken) throw new Error("Microsoft did not return an access token.");
    return {
      accessToken,
      refreshToken: tokens.refresh_token ? String(tokens.refresh_token) : undefined,
      expiresAt: expiresAt(tokens.expires_in),
      scopes: String(tokens.scope ?? this.scopes.join(" ")).split(/\s+/).filter(Boolean),
      accountEmail: undefined,
      externalAccountId: undefined
    };
  }

  async refreshAccessToken(connection: IntegrationConnection): Promise<OAuthTokenSet> {
    const { refreshToken } = encryptedConnectionTokens(connection);
    if (!refreshToken) throw new Error("Missing refresh token. Reconnect Bing Webmaster Tools.");
    const { clientId, clientSecret, tenant } = this.oauthConfig();
    const tokens = await tokenRequest(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      scope: this.scopes.join(" ")
    }));
    return {
      accessToken: String(tokens.access_token ?? ""),
      refreshToken,
      expiresAt: expiresAt(tokens.expires_in),
      scopes: connection.scopes
    };
  }

  async listProperties(connection: IntegrationConnection) {
    const base = process.env.BING_WEBMASTER_API_BASE;
    if (!base) return [];
    const { accessToken } = await freshTokens(this, connection);
    const data = await jsonFetch<{ sites?: Array<{ url?: string; name?: string }> }>(`${base.replace(/\/$/, "")}/sites`, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    return (data.sites ?? []).map((site): ExternalProperty => ({ id: String(site.url ?? ""), name: site.name ?? String(site.url ?? ""), url: site.url })).filter((site) => site.id);
  }

  async validatePropertyAccess(connection: IntegrationConnection, propertyId: string) {
    return (await this.listProperties(connection)).some((property) => property.id === propertyId);
  }

  async fetchInitialData(connection: IntegrationConnection) {
    return fetchBingRange(this, connection, previousDays(90));
  }

  async fetchIncrementalData(connection: IntegrationConnection) {
    return fetchBingRange(this, connection, nextIncrementalRange(connection.lastSyncedAt));
  }

  async testConnection(connection: IntegrationConnection) {
    const sites = await this.listProperties(connection);
    if (!process.env.BING_WEBMASTER_API_BASE) {
      return { ok: false, message: "Bing Webmaster API base URL is not configured for this deployment." };
    }
    return { ok: true, message: `Bing Webmaster access is valid. ${sites.length} sites available.` };
  }

  async disconnect() {}
}

async function fetchBingRange(adapter: BingWebmasterAdapter, connection: IntegrationConnection, range: { startDate: string; endDate: string }) {
  const base = process.env.BING_WEBMASTER_API_BASE;
  if (!base) throw new Error("Bing performance import is unavailable until BING_WEBMASTER_API_BASE is configured for the supported API surface.");
  if (!connection.externalPropertyId) throw new Error("Select a Bing site before syncing.");
  const { accessToken } = await freshTokens(adapter, connection);
  const url = new URL(`${base.replace(/\/$/, "")}/performance`);
  url.searchParams.set("siteUrl", connection.externalPropertyId);
  url.searchParams.set("startDate", range.startDate);
  url.searchParams.set("endDate", range.endDate);
  const data = await jsonFetch<{ rows?: Array<{ date?: string; query?: string; page?: string; clicks?: number; impressions?: number; ctr?: number; position?: number }> }>(
    url.toString(),
    { headers: { authorization: `Bearer ${accessToken}` } }
  );
  const rows = (data.rows ?? []).flatMap((item) => {
    const date = item.date ?? range.endDate;
    const metrics = {
      clicks: Number(item.clicks ?? 0),
      impressions: Number(item.impressions ?? 0),
      ctr: Number(item.ctr ?? 0),
      position: Number(item.position ?? 0)
    };
    return [
      row({ userId: connection.userId, projectId: connection.projectId, provider: connection.provider, propertyId: connection.externalPropertyId ?? "", date, dimensionType: "daily", dimensionValue: "all", metrics }),
      item.query ? row({ userId: connection.userId, projectId: connection.projectId, provider: connection.provider, propertyId: connection.externalPropertyId ?? "", date, dimensionType: "query", dimensionValue: item.query, metrics }) : null,
      item.page ? row({ userId: connection.userId, projectId: connection.projectId, provider: connection.provider, propertyId: connection.externalPropertyId ?? "", date, dimensionType: "page", dimensionValue: item.page, metrics }) : null
    ].filter((value): value is MetricRow => Boolean(value));
  });
  return integrationStore.upsertMetricRows(rows);
}

async function freshTokens(adapter: IntegrationAdapter, connection: IntegrationConnection) {
  const tokens = encryptedConnectionTokens(connection);
  if (!connection.tokenExpiresAt || new Date(connection.tokenExpiresAt).getTime() > Date.now() + 60_000) {
    return tokens;
  }
  const refreshed = await adapter.refreshAccessToken(connection);
  await integrationStore.saveConnection({
    ...connection,
    encryptedAccessToken: encryptSecret(refreshed.accessToken),
    encryptedRefreshToken: refreshed.refreshToken ? encryptSecret(refreshed.refreshToken) : connection.encryptedRefreshToken,
    tokenExpiresAt: refreshed.expiresAt,
    status: "CONNECTED",
    lastSyncError: undefined
  });
  return { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken };
}

export const adapters: Record<IntegrationProvider, IntegrationAdapter> = {
  GOOGLE_SEARCH_CONSOLE: new SearchConsoleAdapter(),
  GOOGLE_ANALYTICS: new GoogleAnalyticsAdapter(),
  BING_WEBMASTER: new BingWebmasterAdapter()
};

export function createPendingConnection(input: {
  userId: string;
  projectId: string;
  provider: IntegrationProvider;
  tokenSet: OAuthTokenSet;
}) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    userId: input.userId,
    projectId: input.projectId,
    provider: input.provider,
    accountEmail: input.tokenSet.accountEmail,
    externalAccountId: input.tokenSet.externalAccountId,
    encryptedAccessToken: encryptSecret(input.tokenSet.accessToken),
    encryptedRefreshToken: input.tokenSet.refreshToken ? encryptSecret(input.tokenSet.refreshToken) : undefined,
    tokenExpiresAt: input.tokenSet.expiresAt,
    scopes: input.tokenSet.scopes,
    status: "CONNECTED" as const,
    connectedAt: now,
    lastSyncStatus: "IDLE" as const,
    createdAt: now,
    updatedAt: now
  };
}
