export const integrationProviders = ["GOOGLE_SEARCH_CONSOLE", "GOOGLE_ANALYTICS", "BING_WEBMASTER"] as const;

export type IntegrationProvider = typeof integrationProviders[number];

export type IntegrationStatus = "CONNECTED" | "DISCONNECTED" | "EXPIRED" | "ERROR";
export type SyncStatus = "IDLE" | "RUNNING" | "SUCCESS" | "PARTIAL" | "ERROR";

export interface IntegrationConnection {
  id: string;
  userId: string;
  projectId: string;
  provider: IntegrationProvider;
  accountEmail?: string;
  externalAccountId?: string;
  externalPropertyId?: string;
  externalPropertyName?: string;
  encryptedAccessToken: string;
  encryptedRefreshToken?: string;
  tokenExpiresAt?: string;
  scopes: string[];
  status: IntegrationStatus;
  connectedAt: string;
  lastSyncedAt?: string;
  lastSyncStatus: SyncStatus;
  lastSyncError?: string;
  importedStartDate?: string;
  importedEndDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublicIntegrationConnection {
  id: string;
  userId: string;
  projectId: string;
  provider: IntegrationProvider;
  accountEmail?: string;
  externalAccountId?: string;
  externalPropertyId?: string;
  externalPropertyName?: string;
  scopes: string[];
  status: IntegrationStatus;
  connectedAt: string;
  lastSyncedAt?: string;
  lastSyncStatus: SyncStatus;
  lastSyncError?: string;
  importedStartDate?: string;
  importedEndDate?: string;
  updatedAt: string;
}

export interface ExternalProperty {
  id: string;
  name: string;
  accountId?: string;
  url?: string;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scopes: string[];
  accountEmail?: string;
  externalAccountId?: string;
}

export interface ProviderAuthState {
  provider: IntegrationProvider;
  userId: string;
  projectId: string;
  nonce: string;
  codeVerifier?: string;
  returnTo?: string;
}

export interface SyncLog {
  id: string;
  userId: string;
  projectId: string;
  provider: IntegrationProvider;
  connectionId: string;
  status: SyncStatus;
  startedAt: string;
  finishedAt?: string;
  importedRows: number;
  error?: string;
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface MetricRow {
  id: string;
  userId: string;
  projectId: string;
  provider: IntegrationProvider;
  propertyId: string;
  date: string;
  dimensionType: "daily" | "query" | "page" | "country" | "device" | "landing_page" | "traffic_source" | "geo" | "crawl";
  dimensionValue: string;
  metrics: Record<string, number | string | null>;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardMetric {
  label: string;
  value: number | string;
  previousValue?: number | string;
  changePercent?: number;
  unavailableReason?: string;
}

export interface DashboardTableRow {
  label: string;
  value: number | string;
  secondary?: number | string;
  changePercent?: number;
}

export interface PerformanceDashboard {
  provider: IntegrationProvider;
  projectId: string;
  connection?: PublicIntegrationConnection;
  range: DateRange;
  metrics: DashboardMetric[];
  trends: Array<Record<string, number | string>>;
  tables: Record<string, DashboardTableRow[]>;
  unsupported: Array<{ label: string; reason: string }>;
}

export interface CombinedInsight {
  id: string;
  projectId: string;
  pageOrQuery: string;
  dataSource: string;
  currentMetric: number;
  previousPeriodMetric: number;
  percentageChange: number;
  relatedTechnicalIssue?: string;
  priority: "Low" | "Medium" | "High" | "Critical";
  priorityScore: number;
  recommendedAction: string;
  evidence: string;
  dateGenerated: string;
}

export interface IntegrationAdapter {
  provider: IntegrationProvider;
  scopes: string[];
  getAuthorizationUrl(input: { state: string; codeChallenge?: string }): string;
  handleOAuthCallback(code: string, codeVerifier?: string): Promise<OAuthTokenSet>;
  refreshAccessToken(connection: IntegrationConnection): Promise<OAuthTokenSet>;
  listProperties(connection: IntegrationConnection): Promise<ExternalProperty[]>;
  validatePropertyAccess(connection: IntegrationConnection, propertyId: string): Promise<boolean>;
  fetchInitialData(connection: IntegrationConnection): Promise<number>;
  fetchIncrementalData(connection: IntegrationConnection): Promise<number>;
  testConnection(connection: IntegrationConnection): Promise<{ ok: boolean; message: string }>;
  disconnect(connection: IntegrationConnection): Promise<void>;
}

export function toPublicConnection(connection: IntegrationConnection): PublicIntegrationConnection {
  return {
    id: connection.id,
    userId: connection.userId,
    projectId: connection.projectId,
    provider: connection.provider,
    accountEmail: connection.accountEmail,
    externalAccountId: connection.externalAccountId,
    externalPropertyId: connection.externalPropertyId,
    externalPropertyName: connection.externalPropertyName,
    scopes: connection.scopes,
    status: connection.status,
    connectedAt: connection.connectedAt,
    lastSyncedAt: connection.lastSyncedAt,
    lastSyncStatus: connection.lastSyncStatus,
    lastSyncError: connection.lastSyncError,
    importedStartDate: connection.importedStartDate,
    importedEndDate: connection.importedEndDate,
    updatedAt: connection.updatedAt
  };
}
