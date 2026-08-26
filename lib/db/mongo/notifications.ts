import { getDb } from "@/lib/mongodb";
import { UNDO_GRACE_MS } from "@/lib/notifications";
import {
  decryptAllFor,
  decryptFor,
  encryptFor,
} from "@/lib/db/mongo/encrypted";
import {
  toDto,
  notificationSchema,
  pushSubscriptionSchema,
  type AppNotification,
  type NotificationDoc,
  type PushSubscriptionDoc,
  type PushSubscriptionRow,
} from "@/lib/schemas";

async function coll() {
  const db = await getDb();
  return db.collection<NotificationDoc>("notifications");
}

async function subs() {
  const db = await getDb();
  return db.collection<PushSubscriptionDoc>("pushSubscriptions");
}

export async function upsertNotification(
  doc: NotificationDoc,
): Promise<void> {
  const full = notificationSchema.parse(doc);
  const enc = await encryptFor("notifications", full.userId, full);
  // Delivery state is split OUT of the $set rather than overwritten with
  // undefined: Mongo would store an explicit null for that, which is how a
  // notification you already read comes back unread on the next materialize.
  // $setOnInsert supplies them once, and only on the row's first write.
  const {
    _id,
    status,
    sentAt,
    readAt,
    ...rest
  } = enc as NotificationDoc;
  await (await coll()).updateOne(
    { _id },
    {
      $set: rest,
      $setOnInsert: { status, sentAt, readAt },
    },
    { upsert: true },
  );
}

export async function listNotifications(
  userId: string,
  limit = 50,
): Promise<AppNotification[]> {
  const docs = await (await coll())
    .find({ userId, status: { $in: ["sent", "read"] } })
    .sort({ fireAt: -1 })
    .limit(limit)
    .toArray();
  const plain = await decryptAllFor("notifications", userId, docs);
  return plain.map((n) => toDto(notificationSchema.parse(n)));
}

export async function getNotification(
  userId: string,
  id: string,
): Promise<AppNotification | null> {
  const doc = await (await coll()).findOne({ _id: id, userId });
  if (!doc) return null;
  return toDto(
    notificationSchema.parse(await decryptFor("notifications", userId, doc)),
  );
}

export async function dueNotifications(
  nowIso: string,
  limit = 200,
): Promise<AppNotification[]> {
  const docs = await (await coll())
    .find({ status: "scheduled", fireAt: { $lte: nowIso } })
    .sort({ fireAt: 1 })
    .limit(limit)
    .toArray();
  // Rows here span users, so they cannot be decrypted in one batch.
  const out: AppNotification[] = [];
  for (const doc of docs) {
    out.push(
      toDto(
        notificationSchema.parse(
          await decryptFor("notifications", doc.userId, doc),
        ),
      ),
    );
  }
  return out;
}

export async function markNotification(
  userId: string,
  id: string,
  patch: Partial<Pick<NotificationDoc, "status" | "sentAt" | "readAt" | "fireAt">>,
): Promise<void> {
  await (await coll()).updateOne({ _id: id, userId }, { $set: patch });
}

export async function markAllRead(userId: string): Promise<number> {
  const res = await (await coll()).updateMany(
    { userId, status: "sent" },
    { $set: { status: "read", readAt: new Date().toISOString() } },
  );
  return res.modifiedCount;
}

export async function deleteScheduledFor(
  userId: string,
  match: { entityId?: string; kind?: NotificationDoc["kind"] },
): Promise<void> {
  await (await coll()).deleteMany({
    userId,
    status: "scheduled",
    ...(match.entityId !== undefined ? { entityId: match.entityId } : {}),
    ...(match.kind !== undefined ? { kind: match.kind } : {}),
  });
}

export async function scheduledIds(userId: string): Promise<string[]> {
  const docs = await (await coll())
    .find({ userId, status: "scheduled" }, { projection: { _id: 1 } })
    .toArray();
  return docs.map((d) => d._id);
}

export async function deleteNotification(
  userId: string,
  id: string,
): Promise<boolean> {
  const res = await (await coll()).deleteOne({ _id: id, userId });
  return res.deletedCount > 0;
}

/**
 * Drop delivered history past the keep count or the age limit.
 *
 * Two deletes rather than one clever query: the age rule is expressible as a
 * filter, the keep rule needs the rows ranked first. Both are indexed on
 * (userId, fireAt) and run on a handful of rows.
 */
export async function pruneNotifications(
  userId: string,
  keep: number,
  cutoffIso: string,
  /** Nothing newer than this is deleted. See the memory impl for why. */
  protectAfterIso: string,
): Promise<number> {
  const c = await coll();
  const byAge = await c.deleteMany({
    userId,
    status: { $in: ["sent", "read"] },
    fireAt: { $lt: cutoffIso },
  });

  // Dismissed rows get a short grace period instead: long enough for undo,
  // short enough that they are not history.
  await c.deleteMany({
    userId,
    status: "dismissed",
    createdAt: { $lt: new Date(Date.now() - UNDO_GRACE_MS).toISOString() },
  });

  const survivors = await c
    .find(
      { userId, status: { $in: ["sent", "read"] } },
      { projection: { _id: 1, fireAt: 1 }, sort: { fireAt: -1 } },
    )
    .toArray();
  // Only rows the planner can no longer recreate are eligible, or trimming
  // to the keep count re-arms whatever it deletes.
  const doomed = survivors
    .slice(keep)
    .filter((d) => d.fireAt < protectAfterIso)
    .map((d) => d._id);
  if (!doomed.length) return byAge.deletedCount;
  const byCount = await c.deleteMany({ _id: { $in: doomed } });
  return byAge.deletedCount + byCount.deletedCount;
}

export async function deleteNotifications(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await (await coll()).deleteMany({ _id: { $in: ids } });
}

// --- push subscriptions ----------------------------------------------------

export async function listPushSubscriptions(
  userId: string,
): Promise<PushSubscriptionRow[]> {
  const docs = await (await subs()).find({ userId }).toArray();
  const plain = await decryptAllFor("pushSubscriptions", userId, docs);
  return plain.map((p) => toDto(pushSubscriptionSchema.parse(p)));
}

export async function upsertPushSubscription(
  doc: PushSubscriptionDoc,
): Promise<PushSubscriptionRow> {
  const full = pushSubscriptionSchema.parse(doc);
  const c = await subs();
  // The endpoint is encrypted, so it cannot be matched with a query. The
  // list is one row per device and the decrypt is cheap.
  const existing = await listPushSubscriptions(full.userId);
  const match = existing.find((p) => p.endpoint === full.endpoint);
  const enc = await encryptFor("pushSubscriptions", full.userId, {
    ...full,
    _id: match?.id ?? full._id,
  });
  const { _id, ...rest } = enc as PushSubscriptionDoc;
  await c.updateOne({ _id }, { $set: rest }, { upsert: true });
  return toDto({ ...full, _id });
}

export async function deletePushSubscription(
  userId: string,
  id: string,
): Promise<void> {
  await (await subs()).deleteOne({ _id: id, userId });
}

export async function deletePushByEndpoint(endpoint: string): Promise<void> {
  // Encrypted at rest, so this is a scan-and-compare rather than a query.
  const c = await subs();
  const docs = await c.find({}).toArray();
  for (const doc of docs) {
    const plain = await decryptFor("pushSubscriptions", doc.userId, doc);
    if (plain.endpoint === endpoint) await c.deleteOne({ _id: doc._id });
  }
}

export async function usersWithPush(): Promise<string[]> {
  const ids = await (await subs()).distinct("userId");
  return ids as string[];
}
