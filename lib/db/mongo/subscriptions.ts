import { getDb } from "@/lib/mongodb";
import { newId } from "@/lib/store/memory";
import { toDto, subscriptionSchema } from "@/lib/schemas";
import type { Subscription, SubscriptionDoc } from "@/lib/schemas";

async function col() {
  const db = await getDb();
  return db.collection<SubscriptionDoc>("subscriptions");
}

export async function getSubscriptionByUserId(
  userId: string,
): Promise<Subscription | null> {
  const c = await col();
  const doc = await c.findOne({ userId });
  return doc ? toDto(subscriptionSchema.parse(doc)) : null;
}

/** Looked up by provider subscriptionId — subscription-resource webhooks and
 *  license-link dedupe don't carry our userId, only the provider's id. */
export async function getSubscriptionBySubscriptionId(
  subscriptionId: string,
): Promise<Subscription | null> {
  const c = await col();
  const doc = await c.findOne({ subscriptionId });
  return doc ? toDto(subscriptionSchema.parse(doc)) : null;
}

/** One subscription row per user — webhook upserts keyed by userId. */
export async function upsertSubscription(
  doc: Omit<SubscriptionDoc, "_id">,
): Promise<Subscription> {
  const c = await col();
  const saved = await c.findOneAndUpdate(
    { userId: doc.userId },
    { $set: doc, $setOnInsert: { _id: newId() } },
    { upsert: true, returnDocument: "after" },
  );
  return toDto(subscriptionSchema.parse(saved));
}

/**
 * Fallback attribution for hosted billing webhooks: when a sale event's
 * url_params[userid] doesn't resolve to an app account, match the verified
 * sale email against Better Auth's own `user` collection (same lookup
 * scripts/claim-user-data.ts and demo provisioning use). Returns the app
 * userId (Better Auth's _id, which is what every other collection keys on).
 */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const db = await getDb();
  const authUser = await db.collection("user").findOne({ email });
  return authUser ? String(authUser._id) : null;
}

/**
 * Record a webhook event id; returns false if it was already processed.
 * Backs idempotent webhook handling (providers retry deliveries).
 */
export async function markWebhookProcessed(eventId: string): Promise<boolean> {
  const db = await getDb();
  try {
    await db
      .collection("webhookEvents")
      .insertOne({ _id: eventId as never, receivedAt: new Date() });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return false; // duplicate
    throw err;
  }
}
