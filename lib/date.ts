import { randomBytes } from "crypto";
import {
  addDaysToIsoDate,
  fakeLocalFromTz,
  formatTimeHMInTz,
  getDefaultTimezone,
  isoDateInTz,
  noonUtcForIsoDate,
  tzParts,
  type TzParts,
} from "@/lib/timezone";

export function oid(): string {
  return randomBytes(12).toString("hex");
}

function tzOrDefault(timeZone?: string): string {
  return timeZone ?? getDefaultTimezone();
}

// Cache display formatters per (kind, timezone) — construction is the costly part.
const enUsFmtCache = new Map<string, Intl.DateTimeFormat>();
function enUsFormatter(
  tz: string,
  kind: "day" | "label" | "due",
): Intl.DateTimeFormat {
  const key = `${kind}|${tz}`;
  let f = enUsFmtCache.get(key);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions =
      kind === "day"
        ? { timeZone: tz, weekday: "short", month: "short", day: "numeric" }
        : kind === "label"
          ? { timeZone: tz, weekday: "long", month: "long", day: "numeric" }
          : { timeZone: tz, month: "short", day: "numeric" };
    f = new Intl.DateTimeFormat("en-US", opts);
    enUsFmtCache.set(key, f);
  }
  return f;
}

export function iso(d: Date = new Date(), timeZone?: string): string {
  return isoDateInTz(d, tzOrDefault(timeZone));
}

export function addDays(
  n: number,
  from: Date = new Date(),
  timeZone?: string,
): Date {
  const tz = tzOrDefault(timeZone);
  const next = addDaysToIsoDate(isoDateInTz(from, tz), n, tz);
  return noonUtcForIsoDate(next, tz);
}

export function formatDay(isoDate: string, timeZone?: string): string {
  const tz = tzOrDefault(timeZone);
  const d = noonUtcForIsoDate(isoDate.slice(0, 10), tz);
  return enUsFormatter(tz, "day").format(d);
}

/** DD/MM from ISO date (e.g. 2026-11-02 → 02/11) */
export function formatDayShort(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}`;
}

/** DD/MM/YYYY from ISO date */
export function formatDayFull(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

/** Default note title when none is given, e.g. "New note 21/06 - 14:35" */
export function defaultNoteTitle(
  d: Date = new Date(),
  timeZone?: string,
): string {
  const tz = tzOrDefault(timeZone);
  const p = tzParts(d, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `New note ${pad(p.day)}/${pad(p.month)} - ${pad(p.hour)}:${pad(p.minute)}`;
}

export type WeekStart = "mon" | "sun";

export const DOW_LETTERS_MON = ["M", "T", "W", "T", "F", "S", "S"] as const;
export const DOW_LETTERS_SUN = ["S", "M", "T", "W", "T", "F", "S"] as const;

export function dowLetters(weekStart: WeekStart = "mon"): readonly string[] {
  return weekStart === "sun" ? DOW_LETTERS_SUN : DOW_LETTERS_MON;
}

export function weekDates(
  from: Date = new Date(),
  weekStart: WeekStart = "mon",
  timeZone?: string,
): Date[] {
  const tz = tzOrDefault(timeZone);
  const p = tzParts(from, tz);
  const offset = weekStart === "sun" ? p.weekday : (p.weekday + 6) % 7;
  const startIso = addDaysToIsoDate(isoDateInTz(from, tz), -offset, tz);
  return Array.from({ length: 7 }, (_, i) =>
    noonUtcForIsoDate(addDaysToIsoDate(startIso, i, tz), tz),
  );
}

export function streakOf(
  dates: Set<string>,
  today: string = iso(),
  timeZone?: string,
): number {
  const tz = tzOrDefault(timeZone);
  let c = 0;
  let cur = isoDateInTz(new Date(), tz);
  if (today) cur = today.slice(0, 10);
  if (!dates.has(cur)) {
    cur = addDaysToIsoDate(cur, -1, tz);
  }
  while (dates.has(cur)) {
    c++;
    cur = addDaysToIsoDate(cur, -1, tz);
  }
  return c;
}

export function bestStreak(dates: Set<string>): number {
  const arr = [...dates].sort();
  let best = 0;
  let cur = 0;
  let prev: string | null = null;
  for (const ds of arr) {
    if (prev) {
      const diff = Math.round(
        (new Date(ds + "T00:00").getTime() -
          new Date(prev + "T00:00").getTime()) /
          86400000,
      );
      cur = diff === 1 ? cur + 1 : 1;
    } else {
      cur = 1;
    }
    best = Math.max(best, cur);
    prev = ds;
  }
  return best;
}

export function dateLabel(d: Date = new Date(), timeZone?: string): string {
  return enUsFormatter(tzOrDefault(timeZone), "label").format(d).toUpperCase();
}

export function weekNumber(d: Date = new Date(), timeZone?: string): number {
  return isoWeekNumber(d, timeZone);
}

import { DEFAULT_USER_NAME } from "@/lib/user-display";

export function greeting(name = DEFAULT_USER_NAME, timeZone?: string): string {
  const hour = tzParts(new Date(), tzOrDefault(timeZone)).hour;
  const part =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}`;
}

export function dueDatePart(due: string | null, timeZone?: string): string {
  if (!due) return "";
  if (due.includes("T")) return due.split("T")[1] ?? "";
  const tz = tzOrDefault(timeZone);
  return enUsFormatter(tz, "due").format(
    noonUtcForIsoDate(due.slice(0, 10), tz),
  );
}

export function taskDueDateInput(due: string | null): string {
  return due?.slice(0, 10) ?? "";
}

/** Preserve meeting time when only the calendar date changes. */
export function mergeTaskDueDate(
  datePart: string,
  existingDue: string | null,
): string | null {
  if (!datePart) return null;
  const time = existingDue?.includes("T") ? existingDue.split("T")[1] : null;
  return time ? `${datePart}T${time}` : datePart;
}

export function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export { LIFE_SPAN_MAX, LIFE_SPAN_DEFAULT } from "./life-constants";

export function addYears(years: number, fromIso: string): string {
  const d = new Date(fromIso + "T00:00");
  d.setFullYear(d.getFullYear() + years);
  return iso(d);
}

export function daysBetween(startIso: string, endIso: string): number {
  const start = new Date(startIso + "T00:00").getTime();
  const end = new Date(endIso + "T00:00").getTime();
  return Math.round((end - start) / 86400000);
}

/** Whole years elapsed since birth on a given date (birthday-aware). */
export function ageAt(
  birthDate: string,
  onDate: string = iso(),
  timeZone?: string,
): number {
  const tz = tzOrDefault(timeZone);
  const birth = tzParts(noonUtcForIsoDate(birthDate.slice(0, 10), tz), tz);
  const on = tzParts(noonUtcForIsoDate(onDate.slice(0, 10), tz), tz);
  let years = on.year - birth.year;
  const beforeBirthday =
    on.month < birth.month || (on.month === birth.month && on.day < birth.day);
  if (beforeBirthday) years -= 1;
  return Math.max(0, years);
}

export function formatTimeHM(d: Date = new Date(), timeZone?: string): string {
  return formatTimeHMInTz(d, tzOrDefault(timeZone));
}

/** Index of the agenda event happening now, or -1 before first / length after last. */
export function currentAgendaIndex(
  times: string[],
  nowMins: number = parseTimeToMinutes(formatTimeHM()),
  timeZone?: string,
): number {
  if (!times.length) return -1;
  const sorted = [...times].sort(
    (a, b) => parseTimeToMinutes(a) - parseTimeToMinutes(b),
  );
  if (nowMins < parseTimeToMinutes(sorted[0])) return -1;
  for (let i = 0; i < sorted.length; i++) {
    const start = parseTimeToMinutes(sorted[i]);
    const next = sorted[i + 1];
    if (!next || nowMins < parseTimeToMinutes(next)) {
      if (nowMins >= start) return i;
    }
  }
  return sorted.length;
}

/** ISO week number (1–53) in the user's timezone. */
export function isoWeekNumber(d: Date = new Date(), timeZone?: string): number {
  const tz = tzOrDefault(timeZone);
  const p = tzParts(d, tz);
  const utc = noonUtcForIsoDate(
    `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`,
    tz,
  );
  const date = new Date(utc);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
  const week1 = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return (
    1 +
    Math.round(
      ((date.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getUTCDay() + 6) % 7)) /
        7,
    )
  );
}

export function isoWeeksInYear(year: number): number {
  return isoWeekNumber(new Date(Date.UTC(year, 11, 28)));
}

export function daysInMonth(d: Date = new Date(), timeZone?: string): number {
  const tz = tzOrDefault(timeZone);
  const p = tzParts(d, tz);
  const next =
    p.month === 12
      ? { year: p.year + 1, month: 1 }
      : { year: p.year, month: p.month + 1 };
  const first = noonUtcForIsoDate(
    `${next.year}-${String(next.month).padStart(2, "0")}-01`,
    tz,
  );
  const last = noonUtcForIsoDate(
    addDaysToIsoDate(isoDateInTz(first, tz), -1, tz),
    tz,
  );
  return tzParts(last, tz).day;
}

/** Mon=1 … Fri=5; weekends return null. */
export function workweekDay(
  d: Date = new Date(),
  timeZone?: string,
): { day: number; label: string } | null {
  const tz = tzOrDefault(timeZone);
  const dow = tzParts(d, tz).weekday;
  if (dow === 0 || dow === 6) return null;
  const labels = ["", "MON", "TUE", "WED", "THU", "FRI"] as const;
  return { day: dow, label: labels[dow]! };
}

export { fakeLocalFromTz };

export type { TzParts };
