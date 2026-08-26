// What should fire, and when. Pure — no database, no clock of its own.
//
// The whole engine rests on one idea: notifications are MATERIALIZED ahead of
// time, not worked out at the moment of delivery. Delivery then costs one
// indexed query ("scheduled, fireAt <= now") instead of expanding every
// recurrence rule every user owns, once a minute, forever.
//
// Materializing repeatedly is only safe because ids are derived from what the
// notification is about rather than generated. Running the planner twice for
// the same window produces the same ids, so the writer upserts over its own
// previous output instead of stacking a duplicate every five minutes.

import type { AgendaItem, Task } from "@/lib/schemas";
import { parseTimeToMinutes } from "@/lib/date";
import { utcForLocalTime } from "@/lib/timezone";
import { expandMeetings, meetingTimeRange } from "@/lib/meetings";
import { ALL_DAY_LABEL } from "@/lib/linked-agenda";
import { parseMeetingBody } from "@/lib/meeting-body";

/** How far ahead the planner looks. Two days covers "tomorrow morning". */
export const HORIZON_DAYS = 2;

/**
 * How late a reminder may be and still be worth sending.
 *
 * Small on purpose. This used to be thirty minutes measured from `fireAt`,
 * which sounds generous until you notice what it means for a lead time: a
 * "ten minutes before" reminder stayed deliverable until twenty minutes AFTER
 * the meeting started, and duly arrived at 09:16 for a 09:00 call. A reminder
 * that lands after the thing began is worse than no reminder, because you
 * reach for your phone expecting to still have time.
 *
 * Two minutes covers a tick that ran a moment late or a container that just
 * restarted. Anything later is judged against the EVENT instead, below.
 */
export const LATE_TOLERANCE_MS = 2 * 60 * 1000;

/**
 * Is this still worth putting on somebody's screen?
 *
 * Yes if it is roughly on time, and yes if the thing has not started yet even
 * though we are late saying so, since a late warning is still a warning. No
 * once the moment has passed: it goes to the tray, where it reads as history
 * rather than interrupting with news that is no longer news.
 */
export function worthSending(
  fireAt: string,
  leadMins: number,
  now: Date = new Date(),
): boolean {
  const at = new Date(fireAt).getTime();
  if (now.getTime() - at <= LATE_TOLERANCE_MS) return true;
  return now.getTime() < new Date(eventStartFrom(fireAt, leadMins)).getTime();
}

/**
 * How much delivered history to keep.
 *
 * A notification tray is not an archive. Its whole job is "what did I miss
 * while I was away", and that question is about the last few things, not the
 * last few hundred — a list nobody can reach the bottom of stops being read
 * at all. Anything past this is dropped on the next pass, so the tray stays
 * something you can take in at a glance and clearing it by hand is a choice
 * rather than a chore.
 */
export const HISTORY_KEEP = 5;

/**
 * And an upper bound in time, for the account that gets one reminder a week.
 * Five rows could otherwise sit there for a month, and a notification about a
 * meeting from three weeks ago is not history, it is litter.
 */
export const HISTORY_MAX_AGE_DAYS = 7;

/**
 * How far back a delivered notification is safe to delete.
 *
 * The planner will happily rebuild any row it can still justify, and a
 * rebuilt row is a SCHEDULED row, which fires. So deleting history the
 * planner can still reach turns the tray's size limit into a loop that
 * re-notifies. A day is comfortably past the longest lead time offered, so
 * anything older than this is genuinely finished with.
 */
export const REPLAN_SAFE_MS = 24 * 60 * 60 * 1000;

/** The lead times offered in Settings. Minutes before the event. */
export const LEAD_CHOICES = [0, 5, 10, 15, 30, 60] as const;

export type NotificationSettings = {
  meetingsEnabled: boolean;
  /** Several are allowed: an hour ahead to prepare, five minutes to walk in. */
  meetingLeadMins: number[];
  tasksEnabled: boolean;
  taskLeadMins: number;
  digestEnabled: boolean;
  /** "HH:MM" in the user's timezone. */
  digestTime: string;
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  meetingsEnabled: true,
  meetingLeadMins: [10],
  tasksEnabled: true,
  taskLeadMins: 0,
  digestEnabled: false,
  digestTime: "09:00",
};

/** A notification the planner decided should exist. */
export type PlannedNotification = {
  id: string;
  kind: "meeting" | "task" | "digest";
  entityId: string;
  entityDate: string;
  leadMins: number;
  fireAt: string;
  title: string;
  body: string;
  url: string;
  joinUrl: string;
};

/**
 * The id of a notification, derived from what it is about.
 *
 * Not a hash: the parts are already short, already unique together, and
 * readable in a database. A stable string means re-planning is an upsert.
 * The user id is in there because two people can be invited to the same
 * mirrored event, and their notifications are not the same row.
 */
export function notificationId(
  userId: string,
  kind: string,
  entityId: string,
  entityDate: string,
  leadMins: number,
): string {
  return [userId, kind, entityId || "-", entityDate || "-", leadMins].join(":");
}

/** Minutes to a human string, for the one line a notification gets. */
export function leadPhrase(leadMins: number): string {
  if (leadMins <= 0) return "now";
  if (leadMins < 60) return `in ${leadMins} min`;
  const h = Math.floor(leadMins / 60);
  const m = leadMins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

/**
 * When the thing itself happens, worked back from when we said something.
 *
 * The row stores `fireAt` (already shifted by the lead) and `leadMins`, so
 * the event's own moment is the two added back together. Storing it a second
 * time would be a field that can disagree with the other two.
 */
export function eventStartFrom(fireAt: string, leadMins: number): string {
  return new Date(new Date(fireAt).getTime() + leadMins * 60_000).toISOString();
}

/**
 * "in 8 min", "now", "12 min ago" — computed against the CURRENT time.
 *
 * The notification's stored body used to carry this phrase, baked in at
 * planning time. An hour later it still read "in 10 min", which is how a
 * reminder ends up lying about the only thing it is for. The clock time is
 * fixed and belongs in the row; anything relative has to be worked out at the
 * moment somebody looks at it.
 */
export function relativeToNow(iso: string, now: Date = new Date()): string {
  const diffMs = new Date(iso).getTime() - now.getTime();
  const mins = Math.round(Math.abs(diffMs) / 60_000);
  if (mins < 1) return "now";
  const phrase =
    mins < 60
      ? `${mins} min`
      : (() => {
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          return m ? `${h}h ${m}m` : `${h}h`;
        })();
  return diffMs > 0 ? `in ${phrase}` : `${phrase} ago`;
}

/**
 * How long a dismissed notification lingers before it is really gone.
 *
 * Dismissing hides it immediately and deletes it later, which is what makes
 * Undo possible without keeping a copy in the browser: the row is still
 * there, just not shown.
 */
export const UNDO_GRACE_MS = 10 * 60_000;

/** Snooze lengths offered in the menu. */
export const SNOOZE_CHOICES = [5, 10, 15, 30, 60] as const;

function shiftIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() - minutes * 60_000).toISOString();
}

/**
 * Everything that should fire between `from` and the end of the horizon.
 *
 * Deliberately takes the full agenda and task list rather than querying: it
 * keeps this testable against fixtures, and the caller already holds both.
 */
export function planNotifications(input: {
  userId: string;
  timeZone: string;
  now: Date;
  today: string;
  horizonEnd: string;
  settings: NotificationSettings;
  agenda: AgendaItem[];
  tasks: Task[];
}): PlannedNotification[] {
  const { userId, timeZone, now, today, horizonEnd, settings } = input;
  const out: PlannedNotification[] = [];
  const nowMs = now.getTime();

  if (settings.meetingsEnabled) {
    for (const occ of expandMeetings(input.agenda, today, horizonEnd)) {
      const m = occ.item;
      // An all-day event has no moment to be ten minutes before. It belongs
      // in the morning digest, which is a different question.
      if (m.time === ALL_DAY_LABEL) continue;
      const mins = parseTimeToMinutes(m.time);
      if (!Number.isFinite(mins)) continue;

      const startsAt = utcForLocalTime(
        occ.date,
        Math.floor(mins / 60),
        mins % 60,
        timeZone,
      ).toISOString();
      const join = parseMeetingBody(m.notes ?? "").conference?.url ?? "";

      for (const lead of dedupeLeads(settings.meetingLeadMins)) {
        const fireAt = shiftIso(startsAt, lead);
        // Nothing to warn about once it has begun. Judged on the MEETING, not
        // on the reminder: a lead time means the fire moment is always in the
        // past relative to the event, so measuring the reminder would keep
        // scheduling warnings for things already under way.
        if (new Date(startsAt).getTime() < nowMs) continue;
        out.push({
          id: notificationId(userId, "meeting", m.id, occ.date, lead),
          kind: "meeting",
          entityId: m.id,
          entityDate: occ.date,
          leadMins: lead,
          fireAt,
          title: m.title,
          // The whole slot, absolute. Anything relative is worked out when
          // it is read, or the row starts lying within the hour, but a range
          // is more use than a start time and never goes stale.
          body: meetingTimeRange(m.time, m.durationMins),
          url: `/calendar?day=${occ.date}`,
          joinUrl: join,
        });
      }
    }
  }

  if (settings.tasksEnabled) {
    for (const t of input.tasks) {
      if (t.status === "done") continue;
      // Only tasks with a TIME. A task due "today" has no moment either, and
      // firing at midnight for it is how notifications get turned off.
      if (!t.due?.includes("T")) continue;
      const date = t.due.slice(0, 10);
      if (date < today || date > horizonEnd) continue;
      const mins = parseTimeToMinutes(t.due.slice(11, 16));
      if (!Number.isFinite(mins)) continue;

      const dueAt = utcForLocalTime(
        date,
        Math.floor(mins / 60),
        mins % 60,
        timeZone,
      ).toISOString();
      const lead = Math.max(0, settings.taskLeadMins);
      const fireAt = shiftIso(dueAt, lead);
      // Same rule as meetings: the deadline is the thing, not the warning.
      if (new Date(dueAt).getTime() < nowMs) continue;
      out.push({
        id: notificationId(userId, "task", t.id, date, lead),
        kind: "task",
        entityId: t.id,
        entityDate: date,
        leadMins: lead,
        fireAt,
        title: t.title,
        body: `Due ${t.due.slice(11, 16)}`,
        url: `/tasks?task=${t.id}`,
        joinUrl: "",
      });
    }
  }

  if (settings.digestEnabled) {
    const mins = parseTimeToMinutes(settings.digestTime);
    if (Number.isFinite(mins)) {
      for (const date of daysFrom(today, horizonEnd)) {
        const fireAt = utcForLocalTime(
          date,
          Math.floor(mins / 60),
          mins % 60,
          timeZone,
        ).toISOString();
        // The digest has no event behind it: the moment IS the thing, so a
        // small tolerance is right here.
        if (new Date(fireAt).getTime() < nowMs - LATE_TOLERANCE_MS) continue;
        const count = countDueOn(input.tasks, date);
        // Nothing to say. A daily "you have 0 tasks" is the fastest way to
        // teach somebody to ignore the app.
        if (count === 0) continue;
        out.push({
          id: notificationId(userId, "digest", "", date, 0),
          kind: "digest",
          entityId: "",
          entityDate: date,
          leadMins: 0,
          fireAt,
          title: `${count} ${count === 1 ? "task" : "tasks"} today`,
          body: "Your day, in one line.",
          url: "/tasks?tab=today",
          joinUrl: "",
        });
      }
    }
  }

  return out.sort((a, b) => (a.fireAt < b.fireAt ? -1 : 1));
}

/** Sorted, unique, sane. A duplicate lead would be a duplicate notification. */
function dedupeLeads(leads: number[]): number[] {
  return [...new Set(leads.filter((n) => Number.isFinite(n) && n >= 0))].sort(
    (a, b) => a - b,
  );
}

function countDueOn(tasks: Task[], date: string): number {
  return tasks.filter(
    (t) => t.status !== "done" && (t.due ?? "").slice(0, 10) === date,
  ).length;
}

/** Every calendar day from `from` to `to`, inclusive. Both are ISO dates. */
function daysFrom(from: string, to: string): string[] {
  const out: string[] = [];
  const [y, m, d] = from.slice(0, 10).split("-").map(Number);
  let ms = Date.UTC(y, m - 1, d);
  for (let i = 0; i <= HORIZON_DAYS + 1; i++) {
    const iso = new Date(ms).toISOString().slice(0, 10);
    if (iso > to) break;
    out.push(iso);
    ms += 86_400_000;
  }
  return out;
}
