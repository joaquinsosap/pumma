// Per-user, per-client request cap for the MCP endpoint.
//
// The app had no general-purpose rate limiter: better-auth guards its own
// endpoints, and the AI actions have a daily quota, but everything else was
// protected by needing a session cookie and a browser. An MCP endpoint is a
// long-lived credential pointed at by an automated caller, so a loop that
// calls list_tasks a thousand times is now an ordinary kind of accident.
//
// Mongo-backed and atomic for the same reason the AI quota is: the app runs as
// a single container today, but an in-process counter is a limit that quietly
// stops being one the moment there are two, and it also forgets everything on
// every deploy.
import "server-only";

const PER_MINUTE = Number(process.env.MCP_RATE_LIMIT_PER_MINUTE ?? 120);

const memoryCounts = new Map<string, number>();

/** The minute this request belongs to. Cheap bucket key, no scheduler. */
function bucket(now: Date): string {
  return now.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm
}

/**
 * Count one MCP request. Returns false when the caller is over its limit.
 *
 * Keyed by user AND client, so one noisy integration cannot exhaust the
 * budget of every other connection the same person has.
 *
 * Counts the request rather than the tool call: a single JSON-RPC request is
 * the unit a client controls, and it is what costs us a database round trip.
 */
export async function reserveMcpRequest(
  userId: string,
  clientId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const minute = bucket(now);
  const key = `${userId}:${clientId}:${minute}`;

  if (process.env.DATA_SOURCE !== "mongodb") {
    const n = (memoryCounts.get(key) ?? 0) + 1;
    memoryCounts.set(key, n);
    // Memory mode is single-user and short-lived; keep the map from growing.
    if (memoryCounts.size > 500) {
      for (const k of memoryCounts.keys()) {
        if (!k.endsWith(minute)) memoryCounts.delete(k);
      }
    }
    return n <= PER_MINUTE;
  }

  const { getDb } = await import("@/lib/mongodb");
  const db = await getDb();
  const doc = await db.collection("mcpRate").findOneAndUpdate(
    { key },
    {
      $inc: { count: 1 },
      // `at` exists for the TTL index to expire the bucket. Without it these
      // rows accumulate one per user, per client, per minute, forever.
      $setOnInsert: { key, userId, clientId, at: now },
    },
    { upsert: true, returnDocument: "after" },
  );
  return (doc?.count ?? 1) <= PER_MINUTE;
}

/** Exposed so the error message can name the actual number. */
export function mcpRateLimitPerMinute(): number {
  return PER_MINUTE;
}
