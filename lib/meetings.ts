// Expanding repeating meetings into concrete dates.
//
// The rule model (lib/schemas recurrenceSchema) is a small subset of iCalendar
// RRULE, and the semantics here follow RFC 5545 where it matters:
//   • COUNT counts occurrences the RULE generates — an occurrence removed via
//     `exceptions` still consumes one of them (so "10 times" stays a stable
//     window even after you delete one).
//   • UNTIL is inclusive.
//   • Monthly on the 31st skips months that are too short (it does not clamp
//     to the 28th/30th), matching Google Calendar and RRULE BYMONTHDAY.
//
// All date math runs in UTC on plain YYYY-MM-DD strings so DST shifts can
// never move a meeting to the previous/next day.
import type { AgendaItem, Recurrence } from "@/lib/schemas";
import { parseTimeToMinutes } from "@/lib/date";

const DAY_MS = 86_400_000;
/** Safety valve so a malformed rule can never spin forever. */
const MAX_STEPS = 3_000;

const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toUtcMs(isoDate: string): number {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

function fromUtcMs(ms: number): string {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** JS getDay() convention: 0=Sun … 6=Sat. */
export function weekdayOf(isoDate: string): number {
  return new Date(toUtcMs(isoDate)).getUTCDay();
}

function daysInMonthUtc(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** One concrete instance of a meeting on a specific day. */
export type MeetingOccurrence = {
  item: AgendaItem;
  /** YYYY-MM-DD this instance falls on. */
  date: string;
  /** True when it came from a repeat rule (vs. a one-off meeting). */
  recurring: boolean;
};

/**
 * Every date in [rangeStart, rangeEnd] (inclusive) this item occurs on.
 * Returns [] for legacy dateless "routine" rows — they aren't real meetings.
 */
export function occurrenceDates(
  item: Pick<AgendaItem, "date" | "recurrence" | "exceptions">,
  rangeStart: string,
  rangeEnd: string,
): string[] {
  const start = item.date;
  if (!start) return [];

  const rec = item.recurrence;
  const skipped = new Set(item.exceptions ?? []);

  if (!rec) {
    if (start < rangeStart || start > rangeEnd) return [];
    return skipped.has(start) ? [] : [start];
  }

  const out: string[] = [];
  let generated = 0;

  // Shared per-candidate bookkeeping. Returns false when the series is over.
  const take = (date: string): boolean => {
    if (date < start) return true; // before the series began — not an occurrence
    if (rec.until && date > rec.until) return false;
    if (rec.count != null && generated >= rec.count) return false;
    generated += 1; // counts pre-exception, per RFC 5545
    if (date > rangeEnd) return false;
    if (date >= rangeStart && !skipped.has(date)) out.push(date);
    return true;
  };

  const interval = Math.max(1, rec.interval || 1);

  if (rec.freq === "daily") {
    let ms = toUtcMs(start);
    for (let i = 0; i < MAX_STEPS; i++) {
      if (!take(fromUtcMs(ms))) break;
      ms += DAY_MS * interval;
    }
    return out;
  }

  if (rec.freq === "weekly") {
    // Empty byWeekday means "the same weekday the series starts on".
    const days = rec.byWeekday.length
      ? [...new Set(rec.byWeekday)].sort((a, b) => a - b)
      : [weekdayOf(start)];
    // Anchor on the Sunday of the start week so `interval` counts whole weeks.
    let weekStartMs = toUtcMs(start) - weekdayOf(start) * DAY_MS;
    outer: for (let w = 0; w < MAX_STEPS; w++) {
      for (const wd of days) {
        if (!take(fromUtcMs(weekStartMs + wd * DAY_MS))) break outer;
      }
      weekStartMs += 7 * DAY_MS * interval;
    }
    return out;
  }

  // monthly — same day-of-month, skipping months that are too short.
  const [sy, sm, sd] = start.slice(0, 10).split("-").map(Number);
  for (let i = 0; i < MAX_STEPS; i++) {
    const monthsFromStart = i * interval;
    const y = sy + Math.floor((sm - 1 + monthsFromStart) / 12);
    const mIdx = (sm - 1 + monthsFromStart) % 12;
    if (sd > daysInMonthUtc(y, mIdx)) continue; // e.g. the 31st in February
    if (!take(fromUtcMs(Date.UTC(y, mIdx, sd)))) break;
  }
  return out;
}

/** All meeting occurrences in a date range, sorted by date then start time. */
export function expandMeetings(
  items: AgendaItem[],
  rangeStart: string,
  rangeEnd: string,
): MeetingOccurrence[] {
  const out: MeetingOccurrence[] = [];
  for (const item of items) {
    if (item.kind !== "meeting") continue;
    for (const date of occurrenceDates(item, rangeStart, rangeEnd)) {
      out.push({ item, date, recurring: item.recurrence != null });
    }
  }
  out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      parseTimeToMinutes(a.item.time) - parseTimeToMinutes(b.item.time),
  );
  return out;
}

/** Occurrences on a single day (the common case for Agenda / a calendar cell). */
export function meetingsOnDay(
  items: AgendaItem[],
  day: string,
): MeetingOccurrence[] {
  return expandMeetings(items, day, day);
}

/** "Every 2 weeks on Mon, Wed · until 2026-09-01" — for buttons and summaries. */
export function describeRecurrence(
  rec: Recurrence | null,
  startDate?: string,
): string {
  if (!rec) return "Does not repeat";
  const n = Math.max(1, rec.interval || 1);
  let base: string;

  if (rec.freq === "daily") {
    base = n === 1 ? "Every day" : `Every ${n} days`;
  } else if (rec.freq === "weekly") {
    const days = rec.byWeekday.length
      ? [...new Set(rec.byWeekday)].sort((a, b) => a - b)
      : startDate
        ? [weekdayOf(startDate)]
        : [];
    const labels = days.map((d) => WEEKDAY_LABELS[d]).join(", ");
    const every = n === 1 ? "Weekly" : `Every ${n} weeks`;
    base = labels ? `${every} on ${labels}` : every;
  } else {
    base = n === 1 ? "Monthly" : `Every ${n} months`;
    if (startDate) base += ` on day ${Number(startDate.slice(8, 10))}`;
  }

  if (rec.count != null) return `${base} · ${rec.count}×`;
  if (rec.until) return `${base} · until ${rec.until}`;
  return base;
}

/** Human duration for a meeting chip: 30m, 1h, 1h 30m. */
export function formatMeetingDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** "10:00 – 11:30" for a meeting starting at `time` and running `mins`. */
export function meetingTimeRange(time: string, mins: number): string {
  const start = parseTimeToMinutes(time);
  const end = start + mins;
  const fmt = (t: number) => `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`;
  return `${fmt(start)} to ${fmt(end)}`;
}
