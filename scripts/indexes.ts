/**
 * Create the recommended indexes for the MongoDB backend.
 * Safe to re-run: createIndex is idempotent for identical specs.
 *
 *   npm run db:indexes
 */
import { Db, MongoClient } from "mongodb";
import { loadScriptEnv } from "./_env";

/** Drop an index if it exists; say so, and never fail the run if it doesn't. */
async function dropIfPresent(db: Db, collection: string, index: string) {
  try {
    await db.collection(collection).dropIndex(index);
    console.log(`  dropped ${collection}.${index}`);
  } catch {
    // IndexNotFound, or the collection doesn't exist yet. Both fine.
  }
}

async function main() {
  loadScriptEnv();
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set (check .env.local).");
  const dbName = process.env.MONGODB_DB ?? "puma";

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);

    await db.collection("tasks").createIndexes([
      { key: { userId: 1, due: 1 } },
      { key: { userId: 1, status: 1 } },
      { key: { projectId: 1 } },
    ]);
    await db
      .collection("habitEntries")
      .createIndex({ userId: 1, habitId: 1, date: 1 }, { unique: true });
    await db.collection("habits").createIndex({ userId: 1 });
    await db.collection("goals").createIndex({ userId: 1, category: 1, order: 1 });
    // Tag names are encrypted, and every write produces different bytes — a
    // unique index on the name would constrain nothing. `nameKey` is the
    // deterministic stand-in that carries the constraint instead. Partial, so
    // rows not yet backfilled don't all collide on a missing field.
    await db
      .collection("tags")
      .createIndex(
        { userId: 1, nameKey: 1 },
        { unique: true, partialFilterExpression: { nameKey: { $exists: true } } }
      );
    await dropIfPresent(db, "tags", "userId_1_name_1");
    // The text index on note content was never queried — nothing in lib/ uses
    // $text — and it cannot work against ciphertext. Search is a client-side
    // filter over already-loaded notes.
    await dropIfPresent(db, "notes", "title_text_body_text");
    await db.collection("settings").createIndex({ userId: 1 }, { unique: true });
    await db
      .collection("lifeWeeks")
      .createIndex({ userId: 1, weekStart: 1 }, { unique: true });
    await db
      .collection("lifeDays")
      .createIndex({ userId: 1, date: 1 }, { unique: true });

    // Billing + demo (landing/payments feature)
    await db
      .collection("subscriptions")
      .createIndex({ userId: 1 }, { unique: true });
    // Processed webhook ids only matter within the provider's retry window.
    await db
      .collection("webhookEvents")
      .createIndex({ receivedAt: 1 }, { expireAfterSeconds: 30 * 86_400 });
    // Demo/register rate-limit counters self-expire.
    await db
      .collection("rateLimits")
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: 2 * 86_400 });
    await db.collection("users").createIndex({ isDemo: 1, demoExpiresAt: 1 });

    // MCP. The audit trail is read newest-first per account, so it wants the
    // compound index; ninety days is long enough to answer "what did that
    // thing do last quarter" and short enough not to accumulate forever.
    await db.collection("mcpAudit").createIndex({ userId: 1, at: -1 });
    await db
      .collection("mcpAudit")
      .createIndex({ at: 1 }, { expireAfterSeconds: 90 * 86_400 });
    // One rate-limit bucket per user, per client, per minute. Without the TTL
    // these rows are never read again and never deleted.
    await db.collection("mcpRate").createIndex({ key: 1 }, { unique: true });
    await db
      .collection("mcpRate")
      .createIndex({ at: 1 }, { expireAfterSeconds: 3600 });

    console.log(`Indexes created on "${dbName}".`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
