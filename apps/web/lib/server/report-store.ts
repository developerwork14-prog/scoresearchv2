import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MongoClient } from "mongodb";
import type { AiVisibilityReport, CoreWebVitalsSnapshot } from "@aiva/core";
import { loadServerEnv } from "./env";

interface StrategyLead {
  reportId: string;
  name: string;
  email: string;
  phone: string;
  brand: string;
  reportUrl: string; 
  createdAt: string;
}

interface InsightSubscription {
  reportId: string;
  email: string;
  brand: string;
  website: string;
  reportUrl: string;
  frequency: "biweekly";
  createdAt: string;
}

interface GoogleSearchConsoleConnection {
  id: string;
  email?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  sites: string[];
  createdAt: string;
  updatedAt: string;
}

declare global {
  var aivaMongoClientPromise: Promise<MongoClient> | undefined;
  var aivaMemoryReports: Map<string, AiVisibilityReport> | undefined;
  var aivaMemoryLeads: StrategyLead[] | undefined;
  var aivaInsightSubscriptions: InsightSubscription[] | undefined;
  var aivaGoogleSearchConsoleConnections: GoogleSearchConsoleConnection[] | undefined;
  var aivaMongoLastError: string | undefined;
  var aivaMongoRetryAfter: number | undefined;
}

const memoryReports = globalThis.aivaMemoryReports ??= new Map<string, AiVisibilityReport>();
const memoryLeads = globalThis.aivaMemoryLeads ??= [];
const memorySubscriptions = globalThis.aivaInsightSubscriptions ??= [];
const memoryGoogleSearchConsoleConnections = globalThis.aivaGoogleSearchConsoleConnections ??= [];
const localReportsFile = path.join(
  process.env.AIVA_LOCAL_DATA_DIR ?? path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "AIVisibilityAnalyzer"),
  "reports.json"
);

async function readLocalReports() {
  try {
    const reports = JSON.parse(await readFile(localReportsFile, "utf8")) as AiVisibilityReport[];
    return new Map(reports.map((report) => [report.id, report]));
  } catch {
    return new Map<string, AiVisibilityReport>();
  }
}

async function saveLocalReport(report: AiVisibilityReport) {
  if (!memoryFallbackAllowed()) return;
  const reports = await readLocalReports();
  reports.set(report.id, report);
  await mkdir(path.dirname(localReportsFile), { recursive: true });
  const temporaryFile = `${localReportsFile}.tmp`;
  await writeFile(temporaryFile, JSON.stringify([...reports.values()]), "utf8");
  await rename(temporaryFile, localReportsFile);
}

function mongoClient() {
  loadServerEnv();
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  if (globalThis.aivaMongoRetryAfter && Date.now() < globalThis.aivaMongoRetryAfter) return null;
  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
    globalThis.aivaMongoLastError = 'MONGODB_URI must start with "mongodb://" or "mongodb+srv://"';
    return null;
  }

  globalThis.aivaMongoClientPromise ??= new MongoClient(uri, {
    serverSelectionTimeoutMS: 3000,
    connectTimeoutMS: 3000
  }).connect();
  return globalThis.aivaMongoClientPromise;
}

async function database() {
  const clientPromise = mongoClient();
  if (!clientPromise) return null;
  try {
    const client = await clientPromise;
    return client.db(process.env.MONGODB_DB ?? "aiva");
  } catch (error) {
    globalThis.aivaMongoClientPromise = undefined;
    globalThis.aivaMongoLastError = error instanceof Error ? error.message : "Unknown MongoDB connection error";
    // A failed DNS/network lookup should not hold every report read for the
    // connection timeout. Retry later while the local development cache serves data.
    globalThis.aivaMongoRetryAfter = Date.now() + 60_000;
    console.error("MongoDB connection failed", error);
    return null;
  }
}

function redactedMongoUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return "";
  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//${parsed.username ? `${parsed.username}:***@` : ""}${parsed.host}${parsed.pathname}`;
  } catch {
    return "Invalid URI format";
  }
}

function memoryFallbackAllowed() {
  return process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production";
}

function persistenceUnavailableMessage() {
  return `Persistent report storage is unavailable. Configure MONGODB_URI for production. Last MongoDB error: ${globalThis.aivaMongoLastError ?? "not connected"}`;
}

export async function reportStoreHealth() {
  const db = await database();
  if (!db) {
    return {
      mode: "memory",
      mongoConfigured: Boolean(process.env.MONGODB_URI),
      database: process.env.MONGODB_DB ?? "aiva",
      uri: redactedMongoUri(),
      lastError: globalThis.aivaMongoLastError ?? null
    };
  }

  await db.command({ ping: 1 });
  globalThis.aivaMongoLastError = undefined;
  return {
    mode: "mongodb",
    mongoConfigured: true,
    database: db.databaseName,
    uri: redactedMongoUri(),
    lastError: null
  };
}

export const reportStore = {
  async save(report: AiVisibilityReport) {
    const db = await database();
    if (!db) {
      if (!memoryFallbackAllowed()) throw new Error(persistenceUnavailableMessage());
      memoryReports.set(report.id, report);
      await saveLocalReport(report);
      return report;
    }

    try {
      await db.collection<AiVisibilityReport>("reports").replaceOne(
        { id: report.id },
        report,
        { upsert: true }
      );
      if (report.coreWebVitals) {
        await db.collection<CoreWebVitalsSnapshot>("core_web_vitals").updateOne(
          { website: report.coreWebVitals.website },
          { $set: report.coreWebVitals },
          { upsert: true }
        );
      }
    } catch (error) {
      console.error("MongoDB report save failed; using memory fallback", error);
      if (!memoryFallbackAllowed()) throw error;
      memoryReports.set(report.id, report);
      await saveLocalReport(report);
    }
    return report;
  },

  async get(id: string) {
    const db = await database();
    if (!db) return memoryReports.get(id) ?? (await readLocalReports()).get(id) ?? null;

    try {
      return await db.collection<AiVisibilityReport>("reports").findOne({ id }, { projection: { _id: 0 } });
    } catch (error) {
      console.error("MongoDB report read failed; using memory fallback", error);
      return memoryReports.get(id) ?? (await readLocalReports()).get(id) ?? null;
    }
  },

  async saveLead(lead: StrategyLead) {
    const db = await database();
    if (!db) {
      memoryLeads.push(lead);
      return lead;
    }

    try {
      await db.collection<StrategyLead>("strategy_leads").insertOne(lead);
    } catch (error) {
      console.error("MongoDB lead save failed; using memory fallback", error);
      memoryLeads.push(lead);
    }
    return lead;
  },

  async saveInsightSubscription(subscription: InsightSubscription) {
    const db = await database();
    if (!db) {
      const existingIndex = memorySubscriptions.findIndex((item) => item.reportId === subscription.reportId && item.email === subscription.email);
      if (existingIndex >= 0) {
        memorySubscriptions[existingIndex] = subscription;
      } else {
        memorySubscriptions.push(subscription);
      }
      return subscription;
    }

    try {
      await db.collection<InsightSubscription>("insight_subscriptions").updateOne(
        { reportId: subscription.reportId, email: subscription.email },
        { $set: subscription },
        { upsert: true }
      );
    } catch (error) {
      console.error("MongoDB insight subscription save failed; using memory fallback", error);
      const existingIndex = memorySubscriptions.findIndex((item) => item.reportId === subscription.reportId && item.email === subscription.email);
      if (existingIndex >= 0) {
        memorySubscriptions[existingIndex] = subscription;
      } else {
        memorySubscriptions.push(subscription);
      }
    }
    return subscription;
  },

  async saveGoogleSearchConsoleConnection(connection: GoogleSearchConsoleConnection) {
    const db = await database();
    if (!db) {
      const existingIndex = memoryGoogleSearchConsoleConnections.findIndex((item) => item.id === connection.id);
      if (existingIndex >= 0) {
        memoryGoogleSearchConsoleConnections[existingIndex] = connection;
      } else {
        memoryGoogleSearchConsoleConnections.push(connection);
      }
      return connection;
    }

    await db.collection<GoogleSearchConsoleConnection>("google_search_console_connections").replaceOne(
      { id: connection.id },
      connection,
      { upsert: true }
    );
    return connection;
  },

  async getGoogleSearchConsoleConnectionForHost(hostname: string) {
    const normalized = hostname.replace(/^www\./, "").toLowerCase();
    const matchesHost = (connection: GoogleSearchConsoleConnection) => connection.sites.some((siteUrl) => {
      if (siteUrl.startsWith("sc-domain:")) return siteUrl.slice("sc-domain:".length).replace(/^www\./, "").toLowerCase() === normalized;
      try {
        return new URL(siteUrl).hostname.replace(/^www\./, "").toLowerCase() === normalized;
      } catch {
        return false;
      }
    });
    const db = await database();
    if (!db) return memoryGoogleSearchConsoleConnections.find(matchesHost) ?? null;

    const candidates = await db.collection<GoogleSearchConsoleConnection>("google_search_console_connections")
      .find({}, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .toArray();
    return candidates.find(matchesHost) ?? null;
  }
};
