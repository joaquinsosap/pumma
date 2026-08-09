// Per-user daily quota + usage telemetry for the AI actions. Mongo-backed so it
// survives restarts and works across replicas; memory mode uses an in-process map
// (the demo has a single user and no real spend).
import "server-only";
import { iso } from "@/lib/date";

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT ?? 50);
// Demo accounts still need their own key to call the AI at all (no operator
// fallback — see lib/ai/api-key.ts), so this isn't protecting our wallet; it's
// just a sane per-day cap consistent with the account being ephemeral.
const DEMO_DAILY_LIMIT = Number(process.env.DEMO_AI_DAILY_LIMIT ?? 5);

type Usage = { inputTokens: number; outputTokens: number };

const memoryCounts = new Map<string, number>();

/**
 * Reserve one AI call for today. Returns false when the user is over quota —
 * callers must NOT hit the model in that case. Atomic (upsert + $inc) so
 * concurrent requests can't sneak past the limit.
 */
export async function reserveAiCall(userId: string): Promise<boolean> {
  const day = iso();
  if (process.env.DATA_SOURCE !== "mongodb") {
    const key = `${userId}:${day}`;
    const n = (memoryCounts.get(key) ?? 0) + 1;
    memoryCounts.set(key, n);
    return n <= DAILY_LIMIT;
  }

  const { getDb } = await import("@/lib/mongodb");
  const db = await getDb();
  const appUser = await db
    .collection("users")
    .findOne({ _id: userId as never }, { projection: { isDemo: 1 } });
  const limit = appUser?.isDemo ? DEMO_DAILY_LIMIT : DAILY_LIMIT;
  const doc = await db.collection("aiUsage").findOneAndUpdate(
    { userId, day },
    {
      $inc: { count: 1 },
      $setOnInsert: { userId, day, inputTokens: 0, outputTokens: 0 },
    },
    { upsert: true, returnDocument: "after" },
  );
  return (doc?.count ?? 1) <= limit;
}

/** Record model token usage for the day (spend telemetry / future dashboards). */
export async function recordAiUsage(
  userId: string,
  usage: Usage,
): Promise<void> {
  if (process.env.DATA_SOURCE !== "mongodb") return;
  const { getDb } = await import("@/lib/mongodb");
  const db = await getDb();
  await db.collection("aiUsage").updateOne(
    { userId, day: iso() },
    {
      $inc: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
    },
    { upsert: true },
  );
}

export const AI_QUOTA_MESSAGE = `Daily AI limit reached (${DAILY_LIMIT} requests). Try again tomorrow.`;
