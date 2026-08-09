import * as memory from "./memory/subscriptions";
import * as mongo from "./mongo/subscriptions";

const impl = process.env.DATA_SOURCE === "mongodb" ? mongo : memory;

export const getSubscriptionByUserId = impl.getSubscriptionByUserId;
export const getSubscriptionBySubscriptionId =
  impl.getSubscriptionBySubscriptionId;
export const upsertSubscription = impl.upsertSubscription;
export const markWebhookProcessed = impl.markWebhookProcessed;
