import { addDays, iso, type WeekStart } from "@/lib/date";

export type HabitFrequencyType = "daily" | "weekly" | "monthly";

/**
 * Which weekdays a daily habit applies on, 0 = Sunday .. 6 = Saturday.
 *
 * A gym habit that runs Monday to Friday is still a *daily* habit — it just
 * does not apply at the weekend. Modelling it as a fourth frequency would
 * mean a second set of period, streak and heat-cell rules; modelling it as a
 * filter over "daily" means the existing rules keep working and only need to
 * know which days to skip.
 *
 * Empty or absent means every day, which is what every habit created before
 * this existed meant.
 */
export type HabitSchedule = { type: string; target: number; days?: number[] };

export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** Does this habit apply on the given date? Only daily habits can say no. */
export function habitAppliesOn(
  frequency: HabitSchedule,
  dateIso: string,
): boolean {
  if (normalizeHabitFrequency(frequency.type) !== "daily") return true;
  const days = frequency.days;
  if (!days || days.length === 0 || days.length === 7) return true;
  return days.includes(new Date(dateIso + "T00:00").getDay());
}

/** "Mon–Fri", "Mon, Wed, Fri", "Every day". */
export function habitScheduleLabel(frequency: HabitSchedule): string {
  if (normalizeHabitFrequency(frequency.type) !== "daily") return "";
  const days = [...(frequency.days ?? [])].sort((a, b) => a - b);
  if (days.length === 0 || days.length === 7) return "Every day";
  const NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // A contiguous run reads better as a range than as a list, and weekdays
  // and weekends are the two runs people actually keep.
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (contiguous && days.length > 2) {
    return `${NAMES[days[0]]}\u2013${NAMES[days[days.length - 1]]}`;
  }
  return days.map((d) => NAMES[d]).join(", ");
}

export type HabitVisibilitySettings = {
  dailyDays: number;
  weeklyWeeks: number;
  monthlyMonths: number;
};

export const HABIT_VISIBILITY_DEFAULTS = {
  dailyDays: { min: 1, default: 30 },
  weeklyWeeks: { min: 1, default: 8 },
  monthlyMonths: { min: 1, default: 3 },
} as const;

export const DEFAULT_HABIT_VISIBILITY: HabitVisibilitySettings = {
  dailyDays: HABIT_VISIBILITY_DEFAULTS.dailyDays.default,
  weeklyWeeks: HABIT_VISIBILITY_DEFAULTS.weeklyWeeks.default,
  monthlyMonths: HABIT_VISIBILITY_DEFAULTS.monthlyMonths.default,
};

export type HabitHeatCell = {
  id: string;
  label: string;
  done: boolean;
  isCurrent: boolean;
  toggleDate: string;
  /** Inclusive bounds of what this box stands for (a day, week, or month). */
  periodStart: string;
  periodEnd: string;
};

export function normalizeHabitFrequency(type: string): HabitFrequencyType {
  if (type === "weekly" || type === "monthly") return type;
  return "daily";
}

export function habitFrequencyLabel(type: HabitFrequencyType): string {
  switch (type) {
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    default:
      return "Daily";
  }
}

function atLeastOne(value: number, min = 1): number {
  return Math.max(min, value);
}

function hasEntryInRange(
  entries: Set<string>,
  start: string,
  end: string,
): boolean {
  for (const date of entries) {
    if (date >= start && date <= end) return true;
  }
  return false;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function weekStartDate(d: Date, weekStart: WeekStart): Date {
  const day = d.getDay();
  const offset = weekStart === "mon" ? (day + 6) % 7 : day;
  const start = new Date(d);
  start.setDate(d.getDate() - offset);
  return start;
}

export function visibleDayCount(visibility: HabitVisibilitySettings): number {
  return atLeastOne(
    visibility.dailyDays,
    HABIT_VISIBILITY_DEFAULTS.dailyDays.min,
  );
}

export function visibleWeekCount(visibility: HabitVisibilitySettings): number {
  return atLeastOne(
    visibility.weeklyWeeks,
    HABIT_VISIBILITY_DEFAULTS.weeklyWeeks.min,
  );
}

export function visibleMonthCount(visibility: HabitVisibilitySettings): number {
  return atLeastOne(
    visibility.monthlyMonths,
    HABIT_VISIBILITY_DEFAULTS.monthlyMonths.min,
  );
}

export function habitHeatCells(
  frequency: HabitFrequencyType,
  visibility: HabitVisibilitySettings,
  entries: Set<string>,
  weekStart: WeekStart,
  today: string = iso(),
  timeZone?: string,
): HabitHeatCell[] {
  const todayDate = new Date(today + "T00:00");

  if (frequency === "monthly") {
    const count = visibleMonthCount(visibility);
    const cells: HabitHeatCell[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const month = new Date(
        todayDate.getFullYear(),
        todayDate.getMonth() - i,
        1,
      );
      const start = iso(startOfMonth(month), timeZone);
      const end = iso(endOfMonth(month), timeZone);
      const isCurrent = i === 0;
      cells.push({
        id: `${month.getFullYear()}-${month.getMonth() + 1}`,
        label: month.toLocaleDateString("en-US", {
          month: "short",
          year: "numeric",
        }),
        done: hasEntryInRange(entries, start, end),
        isCurrent,
        toggleDate: isCurrent ? today : end,
        periodStart: start,
        periodEnd: end,
      });
    }
    return cells;
  }

  if (frequency === "weekly") {
    const count = visibleWeekCount(visibility);
    const currentWeekStart = weekStartDate(todayDate, weekStart);
    const cells: HabitHeatCell[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const start = new Date(currentWeekStart);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      const startIso = iso(start, timeZone);
      const endIso = iso(end, timeZone);
      const isCurrent = i === 0;
      cells.push({
        id: startIso,
        label: `${startIso.slice(5)} – ${endIso.slice(5)}`,
        done: hasEntryInRange(entries, startIso, endIso),
        isCurrent,
        toggleDate: isCurrent ? today : endIso,
        periodStart: startIso,
        periodEnd: endIso,
      });
    }
    return cells;
  }

  const dayCount = visibleDayCount(visibility);
  const cells: HabitHeatCell[] = [];
  for (let k = dayCount - 1; k >= 0; k--) {
    const date = iso(addDays(-k, todayDate, timeZone), timeZone);
    cells.push({
      id: date,
      label: date,
      done: entries.has(date),
      isCurrent: k === 0,
      toggleDate: date,
      periodStart: date,
      periodEnd: date,
    });
  }
  return cells;
}

export function habitVisibilityFromSettings(
  settings: {
    habitVisibleDays?: number;
    habitVisibleWeeks?: number;
    habitVisibleMonths?: number;
    /** @deprecated legacy month-based fields */
    habitVisibleMonthsDaily?: number;
    habitVisibleMonthsWeekly?: number;
    habitVisibleMonthsMonthly?: number;
  } | null,
): HabitVisibilitySettings {
  const dailyDays =
    settings?.habitVisibleDays ??
    (settings?.habitVisibleMonthsDaily != null
      ? settings.habitVisibleMonthsDaily * 30
      : DEFAULT_HABIT_VISIBILITY.dailyDays);

  const weeklyWeeks =
    settings?.habitVisibleWeeks ??
    (settings?.habitVisibleMonthsWeekly != null
      ? settings.habitVisibleMonthsWeekly * 4
      : DEFAULT_HABIT_VISIBILITY.weeklyWeeks);

  const monthlyMonths =
    settings?.habitVisibleMonths ??
    settings?.habitVisibleMonthsMonthly ??
    DEFAULT_HABIT_VISIBILITY.monthlyMonths;

  return {
    dailyDays: atLeastOne(dailyDays, HABIT_VISIBILITY_DEFAULTS.dailyDays.min),
    weeklyWeeks: atLeastOne(
      weeklyWeeks,
      HABIT_VISIBILITY_DEFAULTS.weeklyWeeks.min,
    ),
    monthlyMonths: atLeastOne(
      monthlyMonths,
      HABIT_VISIBILITY_DEFAULTS.monthlyMonths.min,
    ),
  };
}

/**
 * Inclusive bounds of the period a habit is "currently" in (today, this week,
 * or this month). Derived from habitHeatCells so it can never drift from what
 * the boxes actually represent.
 */
export function currentHabitPeriod(
  frequency: HabitFrequencyType,
  weekStart: WeekStart,
  today: string = iso(),
  timeZone?: string,
): { start: string; end: string } {
  const cells = habitHeatCells(
    frequency,
    { dailyDays: 1, weeklyWeeks: 1, monthlyMonths: 1 },
    new Set<string>(),
    weekStart,
    today,
    timeZone,
  );
  const last = cells[cells.length - 1];
  return { start: last.periodStart, end: last.periodEnd };
}

/** Canonical start date of the period that contains `date`. */
export function habitPeriodKey(
  frequency: HabitFrequencyType,
  date: string,
  weekStart: WeekStart,
): string {
  const d = new Date(date.slice(0, 10) + "T00:00");
  if (frequency === "monthly") return `${date.slice(0, 7)}-01`;
  if (frequency === "weekly") return iso(weekStartDate(d, weekStart));
  return date.slice(0, 10);
}

/** Move a period key forward/back by `delta` periods. */
export function stepHabitPeriod(
  frequency: HabitFrequencyType,
  key: string,
  delta: number,
): string {
  const d = new Date(key + "T00:00");
  if (frequency === "monthly") {
    return iso(new Date(d.getFullYear(), d.getMonth() + delta, 1));
  }
  return iso(addDays(frequency === "weekly" ? delta * 7 : delta, d));
}

function donePeriodKeys(
  frequency: HabitFrequencyType,
  entries: Set<string>,
  weekStart: WeekStart,
): Set<string> {
  const keys = new Set<string>();
  for (const date of entries)
    keys.add(habitPeriodKey(frequency, date, weekStart));
  return keys;
}

/**
 * Current streak in the habit's OWN units — consecutive weeks for a weekly
 * habit, months for a monthly one, days for a daily one. Counting raw days
 * made a weekly habit kept up for months read as a streak of 1.
 *
 * The period in progress doesn't break the streak: if this week isn't done
 * yet, counting starts from last week.
 */
export function habitStreak(
  frequency: HabitFrequencyType,
  entries: Set<string>,
  weekStart: WeekStart = "mon",
  today: string = iso(),
  /** Days the habit applies on — a day it skips can't break the run. */
  schedule?: HabitSchedule,
): number {
  const done = donePeriodKeys(frequency, entries, weekStart);
  const applies = (key: string) => !schedule || habitAppliesOn(schedule, key);
  let cur = habitPeriodKey(frequency, today, weekStart);
  // Walk back over days off before deciding the run has ended: a Mon–Fri
  // habit must not lose its streak every Saturday for not being done on a
  // day it was never meant to be done.
  let guard = 0;
  while (!done.has(cur) && !applies(cur) && guard++ < 14) {
    cur = stepHabitPeriod(frequency, cur, -1);
  }
  if (!done.has(cur)) cur = stepHabitPeriod(frequency, cur, -1);
  let count = 0;
  guard = 0;
  while (guard++ < 3650) {
    if (done.has(cur)) {
      count += 1;
    } else if (applies(cur)) {
      break;
    }
    cur = stepHabitPeriod(frequency, cur, -1);
  }
  return count;
}

/** Longest run of consecutive completed periods, in the habit's own units. */
export function habitBestStreak(
  frequency: HabitFrequencyType,
  entries: Set<string>,
  weekStart: WeekStart = "mon",
): number {
  const keys = [...donePeriodKeys(frequency, entries, weekStart)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const key of keys) {
    run = prev && stepHabitPeriod(frequency, prev, 1) === key ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return best;
}
