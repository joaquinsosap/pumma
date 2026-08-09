// One data key per user, wrapped by the master key.
//
// Per user rather than one key for everything, for two reasons: a leak is
// bounded to a single account, and rotation can be done a user at a time
// instead of as one enormous transaction.
//
// The wrapped key lives on the user's own document. It is useless on its own
// — opening it needs the master key, which by design is not in the database.
import type { Db } from "mongodb";
import { randomBytes } from "crypto";
import { masterKey } from "@/lib/crypto/master-key";

type UserKeyDoc = { dekWrapped?: string; dekKeyId?: string };

/**
 * Unwrapped keys, held in memory.
 *
 * Without this every page load would unwrap once per collection, and under
 * the KMS provider that is a billed network round trip each time. The TTL is
 * short because the cache is the one place a usable key sits in plain memory.
 */
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 500;
const cache = new Map<string, { dek: Buffer; expires: number }>();

function cacheGet(userId: string): Buffer | null {
  const hit = cache.get(userId);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(userId);
    return null;
  }
  return hit.dek;
}

function cacheSet(userId: string, dek: Buffer): void {
  // Crude eviction: the oldest insertion goes. A real LRU would be better
  // under pressure, and this is a single-container app serving one user per
  // request — the cap exists to bound memory, not to be clever.
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(userId, { dek, expires: Date.now() + CACHE_TTL_MS });
}

/** Forget every cached key. For tests, and for a future rotation command. */
export function clearUserKeyCache(): void {
  cache.clear();
}

/**
 * The user's data key, creating one on first use.
 *
 * Creation is a conditional update — `dekWrapped: { $exists: false }` — so two
 * concurrent requests for a brand-new account cannot end up with two
 * different keys and half the content encrypted under each. The loser of the
 * race re-reads and gets the winner's key.
 */
export async function getUserDek(db: Db, userId: string): Promise<Buffer> {
  const cached = cacheGet(userId);
  if (cached) return cached;

  const users = db.collection<UserKeyDoc>("users");
  const existing = await users.findOne(
    { _id: userId as never },
    { projection: { dekWrapped: 1, dekKeyId: 1 } },
  );

  if (existing?.dekWrapped) {
    const dek = await masterKey().unwrap(existing.dekWrapped);
    cacheSet(userId, dek);
    return dek;
  }

  const dek = randomBytes(32);
  const provider = masterKey();
  const wrapped = await provider.wrap(dek);

  const res = await users.updateOne(
    { _id: userId as never, dekWrapped: { $exists: false } },
    { $set: { dekWrapped: wrapped, dekKeyId: provider.keyId } },
  );

  if (res.matchedCount === 0) {
    // Either somebody else won the race, or there is no such user. Re-read to
    // tell those apart: a missing user is a real error and must not be
    // papered over with a key that nothing will ever be able to find again.
    const now = await users.findOne(
      { _id: userId as never },
      { projection: { dekWrapped: 1 } },
    );
    if (!now?.dekWrapped) {
      throw new Error(
        `Cannot derive a data key: no user document for ${userId}. ` +
          "The user row must exist before any of their content is written.",
      );
    }
    const winner = await masterKey().unwrap(now.dekWrapped);
    cacheSet(userId, winner);
    return winner;
  }

  cacheSet(userId, dek);
  return dek;
}
