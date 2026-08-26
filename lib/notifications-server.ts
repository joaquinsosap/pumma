import "server-only";

import { listAgenda } from "@/lib/db/agenda";
import { listTasks } from "@/lib/db/tasks";
import { listFeeds, listExternalEvents } from "@/lib/db/calendar-feeds";
import { getSettings } from "@/lib/db/settings";
import {
  deleteNotifications,
  dueNotifications,
  pruneNotifications,
  markNotification,
  scheduledIds,
  upsertNotification,
} from "@/lib/db/notifications";
import { externalToAgenda } from "@/lib/linked-agenda";
import { normalizeTimezone } from "@/lib/timezone";
import { addDaysToIsoDate, isoDateInTz } from "@/lib/timezone";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  HISTORY_KEEP,
  HISTORY_MAX_AGE_DAYS,
  HORIZON_DAYS,
  REPLAN_SAFE_MS,
  eventStartFrom,
  relativeToNow,
  worthSending,
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

  // History is trimmed on the same pass. Doing it here rather than on a
  // schedule of its own means it happens whenever anything else does, and a
  // tray that is never opened never accumulates in the first place.
  await pruneNotifications(
    userId,
    HISTORY_KEEP,
    new Date(
      now.getTime() - HISTORY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
    // Anything newer than this is off limits, because the planner above could
    // still recreate it, and a recreated row is a scheduled row that fires
    // again. One day is comfortably past the longest lead time on offer.
    new Date(now.getTime() - REPLAN_SAFE_MS).toISOString(),
  );

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
 * Rows too late to be useful are marked WITHOUT being returned: they land in
 * the tray as history instead of interrupting with news that is no longer
 * news. See worthSending, which judges that against the event rather than
 * against the reminder.
 */
export async function collectDue(now = new Date()): Promise<
  DeliverableNotification[]
> {
  const rows = await dueNotifications(now.toISOString());
  const out: DeliverableNotification[] = [];
  const sentAt = now.toISOString();

  for (const n of rows) {
    await markNotification(n.userId, n.id, { status: "sent", sentAt });
    if (!worthSending(n.fireAt, n.leadMins, now)) continue;
    out.push({
      id: n.id,
      userId: n.userId,
      title: n.title,
      body: notificationBody(n, now),
      url: n.url,
      joinUrl: n.joinUrl,
      kind: n.kind,
    });
  }
  return out;
}

/**
 * The line under the title, written at the moment it is sent.
 *
 * The stored body is deliberately absolute ("09:00 to 09:30") because a row
 * that says "in 10 min" starts lying within the hour. But a notification is
 * read the instant it arrives, so the relative half is true exactly then, and
 * it is the half that tells you whether to stand up.
 *
 * A phone gives this two lines at most on the lock screen, so the order is
 * what matters most first: how long you have, then when, then whether there
 * is a call to join. "VP daily / 09:00" told somebody nothing they could act
 * on.
 */
function notificationBody(
  n: { body: string; joinUrl: string; kind: string; fireAt: string; leadMins: number },
  now: Date,
): string {
  const starts = eventStartFrom(n.fireAt, n.leadMins);
  const when = relativeToNow(starts, now);
  const parts: string[] = [];

  if (n.kind === "meeting") {
    parts.push(new Date(starts) > now ? `Starts ${when}` : `Started ${when}`);
  } else if (n.kind === "task") {
    parts.push(new Date(starts) > now ? `Due ${when}` : `Was due ${when}`);
  }

  if (n.body) parts.push(n.body);
  // Said last and said plainly: it is the difference between reaching for a
  // laptop and walking to a room.
  if (n.joinUrl) parts.push(joinWord(n.joinUrl));
  return parts.join(" · ");
}

/** Which kind of call, from the link. Named, because "Join" says less. */
function joinWord(url: string): string {
  if (/teams\.microsoft\.com/i.test(url)) return "Teams call";
  if (/zoom\.us/i.test(url)) return "Zoom call";
  if (/meet\.google\.com/i.test(url)) return "Google Meet";
  if (/webex\.com/i.test(url)) return "Webex call";
  return "Has a join link";
}
