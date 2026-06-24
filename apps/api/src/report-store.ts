import { MongoClient } from "mongodb";
import type { AiVisibilityReport, CoreWebVitalsSnapshot } from "@aiva/core";
import { env } from "./env.js";

const memoryStore = new Map<string, AiVisibilityReport>();
let mongoClientPromise: Promise<MongoClient> | undefined;
let mongoLastError: string | undefined;

function mongoClient() {
  if (!env.mongoUri) return null;
  if (!env.mongoUri.startsWith("mongodb://") && !env.mongoUri.startsWith("mongodb+srv://")) {
    mongoLastError = 'MONGODB_URI must start with "mongodb://" or "mongodb+srv://"';
    return null;
  }

  mongoClientPromise ??= new MongoClient(env.mongoUri, {
    serverSelectionTimeoutMS: 3000,
    connectTimeoutMS: 3000
  }).connect();
  return mongoClientPromise;
}

async function database() {
  const clientPromise = mongoClient();
  if (!clientPromise) return null;
  try {
    const client = await clientPromise;
    return client.db(process.env.MONGODB_DB ?? "aiva");
  } catch (error) {
    mongoClientPromise = undefined;
    mongoLastError = error instanceof Error ? error.message : "Unknown MongoDB connection error";
    console.error("MongoDB connection failed", error);
    return null;
  }
}

function redactedMongoUri() {
  if (!env.mongoUri) return "";
  try {
    const parsed = new URL(env.mongoUri);
    return `${parsed.protocol}//${parsed.username ? `${parsed.username}:***@` : ""}${parsed.host}${parsed.pathname}`;
  } catch {
    return "Invalid URI format";
  }
}

function memoryFallbackAllowed() {
  return process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production";
}

function persistenceUnavailableMessage() {
  return `Persistent report storage is unavailable. Configure MONGODB_URI for production. Last MongoDB error: ${mongoLastError ?? "not connected"}`;
}

export const reportStore = {
  async health() {
    const db = await database();
    if (!db) {
      return {
        mode: "memory",
        mongoConfigured: Boolean(env.mongoUri),
        database: process.env.MONGODB_DB ?? "aiva",
        uri: redactedMongoUri(),
        lastError: mongoLastError ?? null
      };
    }

    await db.command({ ping: 1 });
    mongoLastError = undefined;
    return {
      mode: "mongodb",
      mongoConfigured: true,
      database: db.databaseName,
      uri: redactedMongoUri(),
      lastError: null
    };
  },

  async save(report: AiVisibilityReport) {
    const db = await database();
    if (!db) {
      if (!memoryFallbackAllowed()) throw new Error(persistenceUnavailableMessage());
      memoryStore.set(report.id, report);
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
      memoryStore.set(report.id, report);
    }
    return report;
  },

  async get(id: string) {
    const db = await database();
    if (!db) return memoryStore.get(id) ?? null;

    try {
      return await db.collection<AiVisibilityReport>("reports").findOne({ id }, { projection: { _id: 0 } });
    } catch (error) {
      console.error("MongoDB report read failed; using memory fallback", error);
      return memoryStore.get(id) ?? null;
    }
  },

  async saveToMemory(report: AiVisibilityReport) {
    memoryStore.set(report.id, report);
    return report;
  }
};
