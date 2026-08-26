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
import { expandMeetings } from "@/lib/meetings";
import { ALL_DAY_LABEL } from "@/lib/linked-agenda";
import { parseMeetingBody } from "@/lib/meeting-body";

/** How far ahead the planner looks. Two days covers "tomorrow morning". */
export const HORIZON_DAYS = 2;

/**
 * How stale a fire time can be and still be worth showing.
 *
 * A server that was down for three hours must not open with a burst of
 * banners for meetings that already happened. Past this, the row is marked
 * delivered and lands quietly in the tray instead.
 */
export const STALE_AFTER_MS = 30 * 60 * 1000;

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
        // Already past: a reminder for a meeting that started is noise. The
        // meeting itself is still visible in the agenda.
        if (new Date(fireAt).getTime() < nowMs - STALE_AFTER_MS) continue;
        out.push({
          id: notificationId(userId, "meeting", m.id, occ.date, lead),
          kind: "meeting",
          entityId: m.id,
          entityDate: occ.date,
          leadMins: lead,
          fireAt,
          title: m.title,
          body: `${m.time} · ${leadPhrase(lead)}`,
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
      if (new Date(fireAt).getTime() < nowMs - STALE_AFTER_MS) continue;
      out.push({
        id: notificationId(userId, "task", t.id, date, lead),
        kind: "task",
        entityId: t.id,
        entityDate: date,
        leadMins: lead,
        fireAt,
        title: t.title,
        body: lead ? `Due ${leadPhrase(lead)}` : "Due now",
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
        if (new Date(fireAt).getTime() < nowMs - STALE_AFTER_MS) continue;
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
