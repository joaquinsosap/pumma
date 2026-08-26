import { getStore } from "@/lib/store/memory";
import { UNDO_GRACE_MS } from "@/lib/notifications";
import {
  toDto,
  notificationSchema,
  pushSubscriptionSchema,
  type AppNotification,
  type NotificationDoc,
  type PushSubscriptionDoc,
  type PushSubscriptionRow,
} from "@/lib/schemas";

/** Same guard the other stores use: getStore() outlives the code that grew it. */
function store() {
  const s = getStore();
  s.notifications ??= [];
  s.pushSubscriptions ??= [];
  return s;
}

export async function upsertNotification(
  doc: NotificationDoc,
): Promise<void> {
  const full = notificationSchema.parse(doc);
  const rows = store().notifications;
  const at = rows.findIndex((n) => n._id === full._id);
  if (at < 0) {
    rows.push(full);
    return;
  }
  // Already delivered: the payload may be refreshed, but the delivery state
  // is history and re-materializing must never resurrect it as unsent.
  const existing = rows[at];
  rows[at] = {
    ...full,
    status: existing.status === "scheduled" ? full.status : existing.status,
    sentAt: existing.sentAt,
    readAt: existing.readAt,
  };
}

export async function listNotifications(
  userId: string,
  limit = 50,
): Promise<AppNotification[]> {
  return store()
    // Dismissed rows are gone from the user's point of view but still on
    // disk for a few minutes, which is what makes undo possible.
    .notifications.filter(
      (n) =>
        n.userId === userId && (n.status === "sent" || n.status === "read"),
    )
    .sort((a, b) => (a.fireAt < b.fireAt ? 1 : a.fireAt > b.fireAt ? -1 : 0))
    .slice(0, limit)
    .map((n) => toDto(notificationSchema.parse(n)));
}

export async function getNotification(
  userId: string,
  id: string,
): Promise<AppNotification | null> {
  const doc = store().notifications.find(
    (n) => n._id === id && n.userId === userId,
  );
  return doc ? toDto(notificationSchema.parse(doc)) : null;
}

export async function dueNotifications(
  nowIso: string,
  limit = 200,
): Promise<AppNotification[]> {
  return store()
    .notifications.filter((n) => n.status === "scheduled" && n.fireAt <= nowIso)
    .sort((a, b) => (a.fireAt < b.fireAt ? -1 : 1))
    .slice(0, limit)
    .map((n) => toDto(notificationSchema.parse(n)));
}

export async function markNotification(
  userId: string,
  id: string,
  patch: Partial<Pick<NotificationDoc, "status" | "sentAt" | "readAt" | "fireAt">>,
): Promise<void> {
  const rows = store().notifications;
  const at = rows.findIndex((n) => n._id === id && n.userId === userId);
  if (at >= 0) rows[at] = { ...rows[at], ...patch };
}

export async function markAllRead(userId: string): Promise<number> {
  const rows = store().notifications;
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].userId === userId && rows[i].status === "sent") {
      rows[i] = { ...rows[i], status: "read", readAt: new Date().toISOString() };
      n += 1;
    }
  }
  return n;
}

/**
 * Drop scheduled rows for things that no longer exist, or that the user has
 * turned off. Never touches delivered ones: a notification you already saw is
 * part of your history, not a promise we can withdraw.
 */
export async function deleteScheduledFor(
  userId: string,
  match: { entityId?: string; kind?: NotificationDoc["kind"] },
): Promise<void> {
  const s = store();
  s.notifications = s.notifications.filter(
    (n) =>
      !(
        n.userId === userId &&
        n.status === "scheduled" &&
        (match.entityId === undefined || n.entityId === match.entityId) &&
        (match.kind === undefined || n.kind === match.kind)
      ),
  );
}

/** Every id currently scheduled for this user, so the writer can prune. */
export async function scheduledIds(userId: string): Promise<string[]> {
  return store()
    .notifications.filter((n) => n.userId === userId && n.status === "scheduled")
    .map((n) => n._id);
}

/** One row, thrown away by hand. Scoped to its owner. */
export async function deleteNotification(
  userId: string,
  id: string,
): Promise<boolean> {
  const s = store();
  const before = s.notifications.length;
  s.notifications = s.notifications.filter(
    (n) => !(n._id === id && n.userId === userId),
  );
  return s.notifications.length < before;
}

/**
 * Drop delivered history past the keep count or the age limit.
 *
 * Only DELIVERED rows. Scheduled ones are the future and are managed by the
 * planner, which would simply recreate anything pruned here.
 */
export async function pruneNotifications(
  userId: string,
  keep: number,
  cutoffIso: string,
): Promise<number> {
  const s = store();
  const delivered = s.notifications
    .filter(
      (n) =>
        n.userId === userId && (n.status === "sent" || n.status === "read"),
    )
    .sort((a, b) => (a.fireAt < b.fireAt ? 1 : -1));
  const doomed = new Set(
    delivered
      .filter((n, i) => i >= keep || n.fireAt < cutoffIso)
      .map((n) => n._id),
  );
  // Dismissed rows get a short grace period rather than the keep/age rules:
  // long enough that undo works, short enough that they are not history.
  const undoDeadline = new Date(Date.now() - UNDO_GRACE_MS).toISOString();
  for (const n of s.notifications) {
    if (
      n.userId === userId &&
      n.status === "dismissed" &&
      (n.readAt ?? n.sentAt ?? n.createdAt) < undoDeadline
    ) {
      doomed.add(n._id);
    }
  }
  if (!doomed.size) return 0;
  s.notifications = s.notifications.filter((n) => !doomed.has(n._id));
  return doomed.size;
}

export async function deleteNotifications(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const drop = new Set(ids);
  const s = store();
  s.notifications = s.notifications.filter((n) => !drop.has(n._id));
}

// --- push subscriptions ----------------------------------------------------

export async function listPushSubscriptions(
  userId: string,
): Promise<PushSubscriptionRow[]> {
  return store()
    .pushSubscriptions.filter((p) => p.userId === userId)
    .map((p) => toDto(pushSubscriptionSchema.parse(p)));
}

export async function upsertPushSubscription(
  doc: PushSubscriptionDoc,
): Promise<PushSubscriptionRow> {
  const full = pushSubscriptionSchema.parse(doc);
  const rows = store().pushSubscriptions;
  // Keyed by endpoint, not id: the same browser re-subscribing produces the
  // same endpoint, and two rows for it would push twice.
  const at = rows.findIndex(
    (p) => p.userId === full.userId && p.endpoint === full.endpoint,
  );
  if (at >= 0) {
    rows[at] = { ...rows[at], ...full, _id: rows[at]._id };
    return toDto(pushSubscriptionSchema.parse(rows[at]));
  }
  rows.push(full);
  return toDto(full);
}

export async function deletePushSubscription(
  userId: string,
  id: string,
): Promise<void> {
  const s = store();
  s.pushSubscriptions = s.pushSubscriptions.filter(
    (p) => !(p._id === id && p.userId === userId),
  );
}

export async function deletePushByEndpoint(endpoint: string): Promise<void> {
  const s = store();
  s.pushSubscriptions = s.pushSubscriptions.filter(
    (p) => p.endpoint !== endpoint,
  );
}

/** Everyone with at least one subscription — the delivery loop's roster. */
export async function usersWithPush(): Promise<string[]> {
  return [...new Set(store().pushSubscriptions.map((p) => p.userId))];
}
