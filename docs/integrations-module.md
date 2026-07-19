# GLOMAUDIT Integrations Module

## Folder Structure

- `apps/web/lib/server/integrations/types.ts`: provider enums, connection model, normalized metric rows, adapter contract.
- `apps/web/lib/server/integrations/crypto.ts`: AES-256-GCM token encryption.
- `apps/web/lib/server/integrations/adapters.ts`: Google Search Console, GA4, and Bing provider adapters.
- `apps/web/lib/server/integrations/store.ts`: MongoDB collections, unique indexes, and local development memory fallback.
- `apps/web/lib/server/integrations/sync.ts`: initial and incremental sync orchestration with sync logs.
- `apps/web/lib/server/integrations/performance.ts`: dashboard aggregations and rule-based Combined Insights.
- `apps/web/app/api/integrations/**`: connect, callback, properties, select-property, sync, test, disconnect, sync-log routes.
- `apps/web/app/api/performance/**`: Search Console, GA4, Bing, and Combined Insights dashboard APIs.
- `apps/web/app/dashboard/**`: responsive integration and performance screens.

## MongoDB Collections

The native MongoDB driver is used in this codebase. The model mirrors the requested Mongoose schema fields:

- `integration_connections`
- `gsc_daily_metrics`
- `gsc_query_metrics`
- `gsc_page_metrics`
- `gsc_country_metrics`
- `gsc_device_metrics`
- `ga4_daily_metrics`
- `ga4_landing_page_metrics`
- `ga4_traffic_source_metrics`
- `ga4_device_metrics`
- `ga4_geo_metrics`
- `bing_daily_metrics`
- `bing_query_metrics`
- `bing_page_metrics`
- `bing_crawl_metrics`
- `integration_sync_logs`

Unique metric indexes use:

`userId + projectId + provider + propertyId + date + dimensionType + dimensionValue`

Connection uniqueness uses:

`userId + projectId + provider`

## OAuth Setup

Google Cloud:

1. Create or select a Google Cloud project.
2. Configure OAuth consent screen.
3. Create a Web OAuth client.
4. Add redirect URIs for:
   - `/api/integrations/GOOGLE_SEARCH_CONSOLE/callback`
   - `/api/integrations/GOOGLE_ANALYTICS/callback`
5. Enable Search Console API, Google Analytics Admin API, and Google Analytics Data API.
6. Add read-only scopes:
   - `https://www.googleapis.com/auth/webmasters.readonly`
   - `https://www.googleapis.com/auth/analytics.readonly`

Microsoft/Bing:

1. Register an app in Microsoft Entra ID.
2. Add the redirect URI `/api/integrations/BING_WEBMASTER/callback`.
3. Configure delegated read-only access required by your Bing Webmaster API tenant.
4. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_INTEGRATIONS_REDIRECT_URI`.
5. Set `BING_WEBMASTER_API_BASE` only when you have a supported Bing Webmaster API/facade that exposes site listing and performance endpoints.

## Security Checklist

- Provider secrets are read only on the server.
- OAuth state is stored in HTTP-only cookies and validated on callback.
- PKCE is used for integration OAuth starts.
- Tokens are encrypted at rest with `INTEGRATION_TOKEN_ENCRYPTION_KEY`.
- Public API responses redact token material by using `toPublicConnection`.
- Provider scopes are read-only.
- Sync logs store status and error summaries, not token values.
- Disconnection supports token-only removal or token plus imported data removal.
- Production requires authenticated `userId` and `projectId` context.
- Dashboard APIs read normalized MongoDB data instead of calling providers on page load.

## Testing Strategy

- Unit test `crypto.ts` round trips and invalid payload handling.
- Unit test date range and insight scoring rules.
- Mock provider APIs for OAuth callback, token refresh, property listing, and sync imports.
- Integration test each API route with valid and invalid project/user context.
- Verify unique indexes by importing the same provider rows twice.
- E2E test: connect, select property, sync, view dashboard, export CSV, disconnect.
- Add negative tests for OAuth denied, invalid state, missing refresh token, revoked access, quota/rate-limit errors, duplicate property mapping, and sync already running.

## Unsupported Provider Metrics

Bing crawl errors, indexed pages, inbound links, and URL submission status are shown as unavailable unless the configured Bing API surface supports those endpoints. The production routes do not generate mock values.
