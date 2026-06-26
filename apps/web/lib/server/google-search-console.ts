import { randomUUID } from "node:crypto";
import type { GoogleSearchConsoleContext } from "@aiva/core";
import { loadServerEnv } from "./env";
import { reportStore } from "./report-store";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const GOOGLE_API_TIMEOUT_MS = 8000;

export interface GoogleSearchConsoleConnection {
  id: string;
  email?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  sites: string[];
  createdAt: string;
  updatedAt: string;
}

function googleOAuthConfig() {
  loadServerEnv();
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "";
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Google OAuth is not configured. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.");
  }
  return { clientId, clientSecret, redirectUri };
}

export function googleAuthUrl(state: string) {
  const { clientId, redirectUri } = googleOAuthConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GSC_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

async function googleTokenRequest(body: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Google OAuth token request failed: ${JSON.stringify(data)}`);
  return data;
}

export async function exchangeGoogleCode(code: string) {
  const { clientId, clientSecret, redirectUri } = googleOAuthConfig();
  return googleTokenRequest(new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  }));
}

export async function refreshGoogleAccessToken(connection: GoogleSearchConsoleConnection) {
  if (!connection.refreshToken) return connection;
  const { clientId, clientSecret } = googleOAuthConfig();
  const data = await googleTokenRequest(new URLSearchParams({
    refresh_token: connection.refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token"
  }));
  const accessToken = String(data.access_token ?? "");
  const expiresIn = Number(data.expires_in ?? 3600);
  return reportStore.saveGoogleSearchConsoleConnection({
    ...connection,
    accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    updatedAt: new Date().toISOString()
  });
}

export async function listSearchConsoleSites(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(GOOGLE_API_TIMEOUT_MS)
  });
  const data = await response.json().catch(() => ({})) as { siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> };
  if (!response.ok) throw new Error(`Search Console sites request failed: ${JSON.stringify(data)}`);
  return (data.siteEntry ?? [])
    .filter((site) => site.permissionLevel && site.permissionLevel !== "siteUnverifiedUser")
    .map((site) => String(site.siteUrl ?? ""))
    .filter(Boolean);
}

export async function saveGoogleConnectionFromCode(code: string) {
  const tokens = await exchangeGoogleCode(code);
  const accessToken = String(tokens.access_token ?? "");
  const refreshToken = tokens.refresh_token ? String(tokens.refresh_token) : undefined;
  if (!accessToken) throw new Error("Google OAuth did not return an access token.");
  const sites = await listSearchConsoleSites(accessToken);
  const expiresIn = Number(tokens.expires_in ?? 3600);
  return reportStore.saveGoogleSearchConsoleConnection({
    id: randomUUID(),
    accessToken,
    refreshToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    sites,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

function hostnameFor(value: string) {
  const normalized = value.startsWith("http") ? value : `https://${value}`;
  return new URL(normalized).hostname.replace(/^www\./, "").toLowerCase();
}

function siteMatches(siteUrl: string, hostname: string) {
  if (siteUrl.startsWith("sc-domain:")) return siteUrl.slice("sc-domain:".length).replace(/^www\./, "").toLowerCase() === hostname;
  try {
    return new URL(siteUrl).hostname.replace(/^www\./, "").toLowerCase() === hostname;
  } catch {
    return false;
  }
}

export async function googleSearchConsoleContextForWebsite(websiteUrl: string): Promise<GoogleSearchConsoleContext | undefined> {
  const hostname = hostnameFor(websiteUrl);
  const connection = await reportStore.getGoogleSearchConsoleConnectionForHost(hostname);
  if (!connection) return undefined;
  const fresh = connection.expiresAt <= Date.now() + 60_000
    ? await refreshGoogleAccessToken(connection)
    : connection;
  const siteUrl = fresh.sites.find((site) => siteMatches(site, hostname));
  if (!siteUrl) return undefined;
  return {
    accessToken: fresh.accessToken,
    siteUrl,
    inspectionUrl: websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`
  };
}
