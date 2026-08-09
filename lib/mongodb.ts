import "server-only";
import type { Db, MongoClient } from "mongodb";
import {
  DbConnectionError,
  rethrowAsDbConnectionError,
} from "@/lib/db-connection-error";

const globalForMongo = globalThis as unknown as {
  __pummaMongoClient?: Promise<MongoClient>;
  __pummaMongoWarm?: Promise<void>;
};

const MONGO_OPTIONS = {
  serverSelectionTimeoutMS: 5_000,
  connectTimeoutMS: 5_000,
  maxPoolSize: 10,
  // Keep several sockets warm so a request's parallel query batch reuses them
  // instead of opening fresh TLS connections (costly over high-latency links/VPNs).
  minPoolSize: 5,
  maxIdleTimeMS: 0, // don't reap idle sockets — keep the warm pool alive
  // CRITICAL over high latency: the default (2) throttles concurrent socket
  // establishment, so a 10-query parallel batch serializes into ~5 TLS rounds.
  // Allowing the whole pool to connect at once makes a batch take one round-trip.
  maxConnecting: 10,
  heartbeatFrequencyMS: 10_000,
} as const;

// How many sockets to pre-open at boot (the whole pool, so requests never wait
// on a cold handshake). With maxConnecting above, these open in one round-trip.
const WARM_SOCKETS = 10;

function connect(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new DbConnectionError(
      "Database is not configured. Set MONGODB_URI in your environment.",
    );
  }
  return import("mongodb")
    .then(({ MongoClient }) => {
      const client = new MongoClient(uri, MONGO_OPTIONS);
      return client.connect();
    })
    .catch((err) => {
      rethrowAsDbConnectionError(err);
    });
}

function resetMongoClient(): void {
  globalForMongo.__pummaMongoClient = undefined;
  globalForMongo.__pummaMongoWarm = undefined;
}

/** Called once at server boot so the first page visit is not blocked on connect. */
export function warmMongoConnection(): Promise<void> {
  if (process.env.DATA_SOURCE !== "mongodb") {
    return Promise.resolve();
  }
  if (!globalForMongo.__pummaMongoWarm) {
    globalForMongo.__pummaMongoWarm = (async () => {
      const db = await getDb();
      // Open several pooled sockets concurrently so the first real request's
      // parallel batch doesn't serialize on cold TLS handshakes.
      await Promise.all(
        Array.from({ length: WARM_SOCKETS }, () => db.command({ ping: 1 })),
      );
    })().catch((err) => {
      globalForMongo.__pummaMongoWarm = undefined;
      throw err;
    });
  }
  return globalForMongo.__pummaMongoWarm;
}

/** Returns a connected Db, caching the client across hot reloads / requests. */
export async function getDb(): Promise<Db> {
  if (process.env.DATA_SOURCE !== "mongodb") {
    throw new DbConnectionError(
      "Database is not configured for this environment. Set DATA_SOURCE=mongodb to use MongoDB.",
    );
  }
  if (!globalForMongo.__pummaMongoClient) {
    globalForMongo.__pummaMongoClient = connect().catch((err) => {
      resetMongoClient();
      throw err;
    });
  }
  try {
    const client = await globalForMongo.__pummaMongoClient;
    return client.db(process.env.MONGODB_DB ?? "pumma");
  } catch (err) {
    resetMongoClient();
    rethrowAsDbConnectionError(err);
  }
}
