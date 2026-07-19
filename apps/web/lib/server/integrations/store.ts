import { randomUUID } from "node:crypto";
import type { Collection, Db } from "mongodb";
import { integrationsDb } from "./mongo";
import type { IntegrationConnection, IntegrationProvider, MetricRow, SyncLog } from "./types";

declare global {
  var glomauditMemoryIntegrationConnections: IntegrationConnection[] | undefined;
  var glomauditMemoryIntegrationMetrics: MetricRow[] | undefined;
  var glomauditMemoryIntegrationSyncLogs: SyncLog[] | undefined;
}

const memoryConnections = globalThis.glomauditMemoryIntegrationConnections ??= [];
const memoryMetrics = globalThis.glomauditMemoryIntegrationMetrics ??= [];
const memorySyncLogs = globalThis.glomauditMemoryIntegrationSyncLogs ??= [];

const metricCollections: Record<MetricRow["dimensionType"], string> = {
  daily: "gsc_daily_metrics",
  query: "gsc_query_metrics",
  page: "gsc_page_metrics",
  country: "gsc_country_metrics",
  device: "gsc_device_metrics",
  landing_page: "ga4_landing_page_metrics",
  traffic_source: "ga4_traffic_source_metrics",
  geo: "ga4_geo_metrics",
  crawl: "bing_crawl_metrics"
};

function metricCollectionName(row: MetricRow) {
  if (row.provider === "GOOGLE_ANALYTICS" && row.dimensionType === "daily") return "ga4_daily_metrics";
  if (row.provider === "GOOGLE_ANALYTICS" && row.dimensionType === "device") return "ga4_device_metrics";
  if (row.provider === "BING_WEBMASTER" && row.dimensionType === "daily") return "bing_daily_metrics";
  if (row.provider === "BING_WEBMASTER" && row.dimensionType === "query") return "bing_query_metrics";
  if (row.provider === "BING_WEBMASTER" && row.dimensionType === "page") return "bing_page_metrics";
  return metricCollections[row.dimensionType];
}

async function ensureIndexes(db: Db) {
  await Promise.all([
    db.collection<IntegrationConnection>("integration_connections").createIndex({ userId: 1, projectId: 1, provider: 1 }, { unique: true }),
    db.collection<SyncLog>("integration_sync_logs").createIndex({ userId: 1, projectId: 1, provider: 1, startedAt: -1 }),
    ...[
      "gsc_daily_metrics",
      "gsc_query_metrics",
      "gsc_page_metrics",
      "gsc_country_metrics",
      "gsc_device_metrics",
      "ga4_daily_metrics",
      "ga4_landing_page_metrics",
      "ga4_traffic_source_metrics",
      "ga4_device_metrics",
      "ga4_geo_metrics",
      "bing_daily_metrics",
      "bing_query_metrics",
      "bing_page_metrics",
      "bing_crawl_metrics"
    ].map((name) => db.collection<MetricRow>(name).createIndex(
      { userId: 1, projectId: 1, provider: 1, propertyId: 1, date: 1, dimensionType: 1, dimensionValue: 1 },
      { unique: true }
    ))
  ]);
}

async function collection<T extends object>(name: string): Promise<Collection<T> | null> {
  const db = await integrationsDb();
  if (!db) return null;
  await ensureIndexes(db);
  return db.collection<T>(name);
}

export const integrationStore = {
  async listConnections(userId: string, projectId: string) {
    const col = await collection<IntegrationConnection>("integration_connections");
    if (!col) return memoryConnections.filter((item) => item.userId === userId && item.projectId === projectId);
    return col.find({ userId, projectId }, { projection: { _id: 0 } }).sort({ provider: 1 }).toArray();
  },

  async getConnection(userId: string, projectId: string, provider: IntegrationProvider) {
    const col = await collection<IntegrationConnection>("integration_connections");
    if (!col) return memoryConnections.find((item) => item.userId === userId && item.projectId === projectId && item.provider === provider) ?? null;
    return col.findOne({ userId, projectId, provider }, { projection: { _id: 0 } });
  },

  async saveConnection(connection: IntegrationConnection) {
    const now = new Date().toISOString();
    const next = { ...connection, updatedAt: now };
    const col = await collection<IntegrationConnection>("integration_connections");
    if (!col) {
      const index = memoryConnections.findIndex((item) => item.userId === next.userId && item.projectId === next.projectId && item.provider === next.provider);
      if (index >= 0) memoryConnections[index] = next;
      else memoryConnections.push(next);
      return next;
    }
    await col.replaceOne(
      { userId: next.userId, projectId: next.projectId, provider: next.provider },
      next,
      { upsert: true }
    );
    return next;
  },

  async deleteConnection(userId: string, projectId: string, provider: IntegrationProvider, deleteData: boolean) {
    const col = await collection<IntegrationConnection>("integration_connections");
    if (!col) {
      const index = memoryConnections.findIndex((item) => item.userId === userId && item.projectId === projectId && item.provider === provider);
      if (index >= 0) memoryConnections.splice(index, 1);
      if (deleteData) {
        for (let index = memoryMetrics.length - 1; index >= 0; index -= 1) {
          const row = memoryMetrics[index];
          if (row.userId === userId && row.projectId === projectId && row.provider === provider) memoryMetrics.splice(index, 1);
        }
      }
      return;
    }
    await col.deleteOne({ userId, projectId, provider });
    if (deleteData) {
      const db = await integrationsDb();
      if (db) await Promise.all([
        "gsc_daily_metrics", "gsc_query_metrics", "gsc_page_metrics", "gsc_country_metrics", "gsc_device_metrics",
        "ga4_daily_metrics", "ga4_landing_page_metrics", "ga4_traffic_source_metrics", "ga4_device_metrics", "ga4_geo_metrics",
        "bing_daily_metrics", "bing_query_metrics", "bing_page_metrics", "bing_crawl_metrics"
      ].map((name) => db.collection(name).deleteMany({ userId, projectId, provider })));
    }
  },

  async upsertMetricRows(rows: MetricRow[]) {
    if (!rows.length) return 0;
    const db = await integrationsDb();
    if (!db) {
      for (const row of rows) {
        const index = memoryMetrics.findIndex((item) =>
          item.userId === row.userId
          && item.projectId === row.projectId
          && item.provider === row.provider
          && item.propertyId === row.propertyId
          && item.date === row.date
          && item.dimensionType === row.dimensionType
          && item.dimensionValue === row.dimensionValue
        );
        if (index >= 0) memoryMetrics[index] = row;
        else memoryMetrics.push(row);
      }
      return rows.length;
    }
    await ensureIndexes(db);
    const groups = new Map<string, MetricRow[]>();
    for (const row of rows) {
      const name = metricCollectionName(row);
      groups.set(name, [...(groups.get(name) ?? []), row]);
    }
    for (const [name, groupedRows] of groups) {
      await db.collection<MetricRow>(name).bulkWrite(groupedRows.map((row) => ({
        replaceOne: {
          filter: {
            userId: row.userId,
            projectId: row.projectId,
            provider: row.provider,
            propertyId: row.propertyId,
            date: row.date,
            dimensionType: row.dimensionType,
            dimensionValue: row.dimensionValue
          },
          replacement: row,
          upsert: true
        }
      })), { ordered: false });
    }
    return rows.length;
  },

  async getMetrics(userId: string, projectId: string, provider: IntegrationProvider, startDate: string, endDate: string) {
    const db = await integrationsDb();
    if (!db) {
      return memoryMetrics.filter((item) =>
        item.userId === userId
        && item.projectId === projectId
        && item.provider === provider
        && item.date >= startDate
        && item.date <= endDate
      );
    }
    await ensureIndexes(db);
    const names = provider === "GOOGLE_SEARCH_CONSOLE"
      ? ["gsc_daily_metrics", "gsc_query_metrics", "gsc_page_metrics", "gsc_country_metrics", "gsc_device_metrics"]
      : provider === "GOOGLE_ANALYTICS"
        ? ["ga4_daily_metrics", "ga4_landing_page_metrics", "ga4_traffic_source_metrics", "ga4_device_metrics", "ga4_geo_metrics"]
        : ["bing_daily_metrics", "bing_query_metrics", "bing_page_metrics", "bing_crawl_metrics"];
    const results = await Promise.all(names.map((name) =>
      db.collection<MetricRow>(name).find({ userId, projectId, provider, date: { $gte: startDate, $lte: endDate } }, { projection: { _id: 0 } }).toArray()
    ));
    return results.flat();
  },

  async createSyncLog(input: Omit<SyncLog, "id" | "startedAt" | "importedRows">) {
    const log: SyncLog = { ...input, id: randomUUID(), startedAt: new Date().toISOString(), importedRows: 0 };
    const col = await collection<SyncLog>("integration_sync_logs");
    if (!col) memorySyncLogs.push(log);
    else await col.insertOne(log);
    return log;
  },

  async finishSyncLog(log: SyncLog, status: SyncLog["status"], importedRows: number, error?: string) {
    const next: SyncLog = { ...log, status, importedRows, error, finishedAt: new Date().toISOString() };
    const col = await collection<SyncLog>("integration_sync_logs");
    if (!col) {
      const index = memorySyncLogs.findIndex((item) => item.id === log.id);
      if (index >= 0) memorySyncLogs[index] = next;
      return next;
    }
    await col.replaceOne({ id: log.id }, next);
    return next;
  },

  async listSyncLogs(userId: string, projectId: string, provider: IntegrationProvider) {
    const col = await collection<SyncLog>("integration_sync_logs");
    if (!col) return memorySyncLogs.filter((item) => item.userId === userId && item.projectId === projectId && item.provider === provider).slice(-50).reverse();
    return col.find({ userId, projectId, provider }, { projection: { _id: 0 } }).sort({ startedAt: -1 }).limit(50).toArray();
  }
};
