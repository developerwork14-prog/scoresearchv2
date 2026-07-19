import { encryptSecret } from "./crypto";
import { integrationStore } from "./store";
import type { IntegrationAdapter, IntegrationConnection } from "./types";

export async function runIntegrationSync(adapter: IntegrationAdapter, connection: IntegrationConnection, mode: "initial" | "incremental" = "incremental") {
  const running = connection.lastSyncStatus === "RUNNING";
  if (running) throw new Error("Sync already running for this provider.");
  const log = await integrationStore.createSyncLog({
    userId: connection.userId,
    projectId: connection.projectId,
    provider: connection.provider,
    connectionId: connection.id,
    status: "RUNNING"
  });
  await integrationStore.saveConnection({ ...connection, lastSyncStatus: "RUNNING", lastSyncError: undefined });
  try {
    let activeConnection = connection;
    if (connection.tokenExpiresAt && new Date(connection.tokenExpiresAt).getTime() <= Date.now() + 60_000) {
      const tokenSet = await adapter.refreshAccessToken(connection);
      activeConnection = await integrationStore.saveConnection({
        ...connection,
        encryptedAccessToken: encryptSecret(tokenSet.accessToken),
        encryptedRefreshToken: tokenSet.refreshToken ? encryptSecret(tokenSet.refreshToken) : connection.encryptedRefreshToken,
        tokenExpiresAt: tokenSet.expiresAt,
        status: "CONNECTED"
      });
    }
    const importedRows = mode === "initial"
      ? await adapter.fetchInitialData(activeConnection)
      : await adapter.fetchIncrementalData(activeConnection);
    const now = new Date().toISOString();
    const next = await integrationStore.saveConnection({
      ...activeConnection,
      lastSyncedAt: now,
      lastSyncStatus: "SUCCESS",
      lastSyncError: undefined,
      importedStartDate: activeConnection.importedStartDate ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      importedEndDate: now.slice(0, 10)
    });
    await integrationStore.finishSyncLog(log, "SUCCESS", importedRows);
    return { connection: next, importedRows };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Integration sync failed.";
    await integrationStore.saveConnection({
      ...connection,
      status: /refresh|revoked|expired|token/i.test(message) ? "EXPIRED" : "ERROR",
      lastSyncStatus: "ERROR",
      lastSyncError: message
    });
    await integrationStore.finishSyncLog(log, "ERROR", 0, message);
    throw error;
  }
}
