import { MongoClient } from "mongodb";
import { loadServerEnv } from "../env";

declare global {
  var glomauditIntegrationsMongoClientPromise: Promise<MongoClient> | undefined;
  var glomauditIntegrationsMongoLastError: string | undefined;
}

export async function integrationsDb() {
  loadServerEnv();
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
    globalThis.glomauditIntegrationsMongoLastError = "Invalid MongoDB URI.";
    return null;
  }
  try {
    globalThis.glomauditIntegrationsMongoClientPromise ??= new MongoClient(uri, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000
    }).connect();
    const client = await globalThis.glomauditIntegrationsMongoClientPromise;
    return client.db(process.env.MONGODB_DB ?? "aiva");
  } catch (error) {
    globalThis.glomauditIntegrationsMongoClientPromise = undefined;
    globalThis.glomauditIntegrationsMongoLastError = error instanceof Error ? error.message : "MongoDB connection failed.";
    console.error("Integration MongoDB connection failed", error);
    return null;
  }
}
