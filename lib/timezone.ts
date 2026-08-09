/** IANA timezone helpers — safe on server and client (no next/headers). */

export const TIMEZONE_COOKIE = "pumma-timezone";

const COMMON_TIMEZONES = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
] as const;

const labelCache = new Map<string, string>();

// Constructing Intl.DateTimeFormat is expensive; iso()/addDays()/tzParts() run in
// hot loops (streaks, heatmaps, metrics, per-row formatting). Cache one formatter
// per timezone and reuse it — only .format()/.formatToParts() runs per call.
const isoFmtCache = new Map<string, Intl.DateTimeFormat>();
const partsFmtCache = new Map<string, Intl.DateTimeFormat>();
const validCache = new Map<string, boolean>();
let defaultTzCache: string | null = null;

function isoFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = isoFmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    isoFmtCache.set(timeZone, f);
  }
  return f;
}

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hour12: false,
    });
    partsFmtCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimezone(timeZone: string): boolean {
  if (!timeZone) return false;
  const cached = validCache.get(timeZone);
  if (cached !== undefined) return cached;
  let ok = true;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
  } catch {
    ok = false;
  }
  validCache.set(timeZone, ok);
  return ok;
}

export function getDefaultTimezone(): string {
  if (defaultTzCache) return defaultTzCache;
  try {
    defaultTzCache = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    defaultTzCache = "UTC";
  }
  return defaultTzCache;
}

export function normalizeTimezone(timeZone: string | null | undefined): string {
  if (timeZone && isValidTimezone(timeZone)) return timeZone;
  return getDefaultTimezone();
}

/** Curated list for settings UI — avoids loading 600+ IANA zones. */
export function listTimezoneOptions(current?: string): string[] {
  const set = new Set<string>(COMMON_TIMEZONES);
  if (current && isValidTimezone(current)) set.add(current);
  return [...set].sort();
}

export function formatTimezoneLabel(timeZone: string): string {
  const cached = labelCache.get(timeZone);
  if (cached) return cached;

  let label: string;
  try {
    const now = new Date();
    const offset =
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "shortOffset",
      })
        .formatToParts(now)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    label = offset
      ? `${timeZone.replace(/_/g, " ")} (${offset})`
      : timeZone.replace(/_/g, " ");
  } catch {
    label = timeZone.replace(/_/g, " ");
  }
  labelCache.set(timeZone, label);
  return label;
}

export type TimezoneOption = { value: string; label: string };

export function buildTimezoneOptions(current?: string): TimezoneOption[] {
  return listTimezoneOptions(current).map((value) => ({
    value,
    label: formatTimezoneLabel(value),
  }));
}

export type TzParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

export function tzParts(date: Date, timeZone: string): TzParts {
  const f = partsFormatter(timeZone);
  const map = Object.fromEntries(
    f
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: weekdayMap[map.weekday] ?? 0,
  };
}

/** Calendar date YYYY-MM-DD in the given timezone. */
export function isoDateInTz(date: Date, timeZone: string): string {
  return isoFormatter(timeZone).format(date);
}

/** Wall-clock time HH:mm in the given timezone. */
export function formatTimeHMInTz(date: Date, timeZone: string): string {
  const p = tzParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Date whose local getters match the user's wall clock (for chrono-node). */
export function fakeLocalFromTz(date: Date, timeZone: string): Date {
  const p = tzParts(date, timeZone);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** UTC instant for noon on a calendar day in a timezone (avoids DST midnight edges). */
export function noonUtcForIsoDate(isoDate: string, timeZone: string): Date {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  let ms = Date.UTC(y, m - 1, d, 12, 0, 0);
  for (let i = 0; i < 4; i++) {
    const p = tzParts(new Date(ms), timeZone);
    const diffMin =
      (p.year - y) * 525600 +
      (p.month - m) * 43200 +
      (p.day - d) * 1440 +
      (p.hour - 12) * 60 +
      p.minute;
    if (diffMin === 0) break; // already at local noon — no need to keep iterating
    ms -= diffMin * 60_000;
  }
  return new Date(ms);
}

export function addDaysToIsoDate(
  isoDate: string,
  days: number,
  timeZone: string,
): string {
  const noon = noonUtcForIsoDate(isoDate, timeZone);
  noon.setUTCDate(noon.getUTCDate() + days);
  return isoDateInTz(noon, timeZone);
}
