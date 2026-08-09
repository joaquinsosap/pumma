// Memory-mode billing stubs: the local demo has no billing, but the module
// shape must match the mongo impl so the barrel switch works.
import { newId } from "@/lib/store/memory";
import { toDto, subscriptionSchema } from "@/lib/schemas";
import type { Subscription, SubscriptionDoc } from "@/lib/schemas";

const subs = new Map<string, SubscriptionDoc>(); // by userId
const seenEvents = new Set<string>();

export async function getSubscriptionByUserId(
  userId: string,
): Promise<Subscription | null> {
  const doc = subs.get(userId);
  return doc ? toDto(subscriptionSchema.parse(doc)) : null;
}

export async function getSubscriptionBySubscriptionId(
  subscriptionId: string,
): Promise<Subscription | null> {
  for (const doc of subs.values()) {
    if (doc.subscriptionId === subscriptionId)
      return toDto(subscriptionSchema.parse(doc));
  }
  return null;
}

export async function upsertSubscription(
  doc: Omit<SubscriptionDoc, "_id">,
): Promise<Subscription> {
  const existing = subs.get(doc.userId);
  const full = { ...doc, _id: existing?._id ?? newId() };
  subs.set(doc.userId, full);
  return toDto(subscriptionSchema.parse(full));
}

export async function markWebhookProcessed(eventId: string): Promise<boolean> {
  if (seenEvents.has(eventId)) return false;
  seenEvents.add(eventId);
  return true;
}
