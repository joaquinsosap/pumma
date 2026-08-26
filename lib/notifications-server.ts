import "server-only";

import { listAgenda } from "@/lib/db/agenda";
import { listTasks } from "@/lib/db/tasks";
import { listFeeds, listExternalEvents } from "@/lib/db/calendar-feeds";
import { getSettings } from "@/lib/db/settings";
import {
  deleteNotifications,
  dueNotifications,
  markNotification,
  scheduledIds,
  upsertNotification,
} from "@/lib/db/notifications";
import { externalToAgenda } from "@/lib/linked-agenda";
import { normalizeTimezone } from "@/lib/timezone";
import { addDaysToIsoDate, isoDateInTz } from "@/lib/timezone";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  HORIZON_DAYS,
  STALE_AFTER_MS,
  planNotifications,
  type NotificationSettings,
} from "@/lib/notifications";
import { notificationSchema } from "@/lib/schemas";

/**
 * Rebuild one user's scheduled notifications for the next couple of days.
 *
 * Idempotent by construction: the planner derives ids from what each
 * notification is about, so running this twice a minute would produce the
 * same rows twice, and the writer upserts them. That is what lets it be
 * called freely — on a timer, after a meeting is saved, after a calendar
 * syncs — without any coordination between those callers.
 *
 * Anything scheduled that the plan no longer contains is deleted. That is how
 * a cancelled meeting, a completed task, a removed calendar or a switched-off
 * setting take their reminders with them; nothing has to remember to clean up
 * after itself. Rows already DELIVERED are never touched — a notification you
 * have seen is history, not a promise we can withdraw.
 */
export async function materializeFor(
  userId: string,
  /**
   * The caller's resolved timezone, when there is a request to resolve it
   * from.
   *
   * This matters more than it looks. The app resolves timezone COOKIE-FIRST,
   * and the browser's real zone is only ever written to that cookie — the
   * stored setting keeps its "UTC" default until somebody changes it by hand
   * in Settings. A background tick has no cookie, so planning from the stored
   * setting alone would put every reminder hours out for anyone who never
   * touched that field, which is nearly everyone.
   *
   * So: request paths pass what they resolved, and the client also persists
   * its zone into settings once (see syncTimezoneAction) so the ticks that
   * have no request left to ask still have something true to read.
   */
  timeZoneOverride?: string,
): Promise<number> {
  const settings = await getSettings(userId);
  const prefs: NotificationSettings = {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...(settings?.notifications ?? {}),
  };

  const timeZone = normalizeTimezone(timeZoneOverride ?? settings?.timezone);
  const now = new Date();
  const today = isoDateInTz(now, timeZone);
  const horizonEnd = addDaysToIsoDate(today, HORIZON_DAYS, timeZone);

  const [ownAgenda, externalEvents, feeds, tasks] = await Promise.all([
    listAgenda(userId),
    listExternalEvents(userId),
    listFeeds(userId),
    listTasks(userId),
  ]);

  const planned = planNotifications({
    userId,
    timeZone,
    now,
    today,
    horizonEnd,
    settings: prefs,
    agenda: [...ownAgenda, ...externalToAgenda(externalEvents, feeds)],
    tasks,
  });

  const createdAt = now.toISOString();
  for (const p of planned) {
    await upsertNotification(
      notificationSchema.parse({
        _id: p.id,
        userId,
        kind: p.kind,
        entityId: p.entityId,
        entityDate: p.entityDate,
        leadMins: p.leadMins,
        fireAt: p.fireAt,
        status: "scheduled",
        title: p.title,
        body: p.body,
        url: p.url,
        joinUrl: p.joinUrl,
        sentAt: null,
        readAt: null,
        createdAt,
      }),
    );
  }

  const keep = new Set(planned.map((p) => p.id));
  const stale = (await scheduledIds(userId)).filter((id) => !keep.has(id));
  await deleteNotifications(stale);

  return planned.length;
}

/**
 * Called after a write that could change what should fire.
 *
 * Deliberately swallows its errors. Saving a meeting must not fail because
 * the reminder for it could not be recalculated — the timer will pick it up
 * within the tick anyway, so the worst case is a reminder that is a few
 * minutes late rather than a save that did not happen.
 */
export async function refreshNotifications(userId: string): Promise<void> {
  try {
    // Inside a request, so the cookie-first resolver is available and is the
    // only source that knows the browser's actual zone.
    const { resolveTimezoneWithSettings } = await import(
      "@/lib/timezone-server"
    );
    await materializeFor(userId, await resolveTimezoneWithSettings());
  } catch {
    /* the periodic pass will catch up */
  }
}

export type DeliverableNotification = {
  id: string;
  userId: string;
  title: string;
  body: string;
  url: string;
  joinUrl: string;
  kind: string;
};

/**
 * Everything whose moment has arrived, marked as delivered.
 *
 * Marking happens HERE rather than after the push succeeds, on purpose: a
 * push that fails is one device missing one banner, while a row left
 * scheduled would be retried every minute forever, so a single dead endpoint
 * would turn into an endless loop of the same notification.
 *
 * Rows whose moment passed a long time ago are marked without being returned.
 * A server that was down for three hours must not wake up and fire a burst of
 * banners for meetings that already ended; those land quietly in the tray.
 */
export async function collectDue(now = new Date()): Promise<
  DeliverableNotification[]
> {
  const rows = await dueNotifications(now.toISOString());
  const out: DeliverableNotification[] = [];
  const sentAt = now.toISOString();

  for (const n of rows) {
    await markNotification(n.userId, n.id, { status: "sent", sentAt });
    if (now.getTime() - new Date(n.fireAt).getTime() > STALE_AFTER_MS) continue;
    out.push({
      id: n.id,
      userId: n.userId,
      title: n.title,
      body: n.body,
      url: n.url,
      joinUrl: n.joinUrl,
      kind: n.kind,
    });
  }
  return out;
}
