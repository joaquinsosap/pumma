import type { LifeMood, LifeWeek } from "@/lib/schemas";
import { addYears, ageAt, daysBetween, iso, LIFE_SPAN_MAX } from "@/lib/date";
import { LIFE_SPAN_DEFAULT } from "@/lib/life-constants";

export type LifeWeekSlot = {
  weekIndex: number;
  weekStart: string;
  weekEnd: string;
  days: string[];
};

export type LifeCalendarRow = {
  age: number;
  cells: (LifeWeekSlot | null)[];
  showAgeLabel: boolean;
  ageEmphasis: boolean;
  yearLabel: string;
  yearEmphasis: boolean;
  decadeGap: boolean;
};

export type LifeWeekGrid = {
  weeks: LifeWeekSlot[];
  rows: LifeCalendarRow[];
  viewStartAge: number;
};

export type LifeStats = {
  totalDays: number;
  livedDays: number;
  leftDays: number;
  livedPct: number;
  totalWeeks: number;
  livedWeeks: number;
  leftWeeks: number;
  livedWeeksPct: number;
  ageYears: number;
  ageLeftYears: number;
  birthDate: string;
  endDate: string;
  today: string;
};

export const LIFE_MOODS: {
  value: LifeMood;
  label: string;
  color: string;
}[] = [
  { value: "great", label: "great", color: "oklch(0.64 0.14 155)" },
  { value: "good", label: "good", color: "oklch(0.74 0.12 170)" },
  { value: "okay", label: "okay", color: "oklch(0.8 0.13 85)" },
  { value: "low", label: "low", color: "oklch(0.72 0.15 55)" },
  { value: "rough", label: "rough", color: "oklch(0.62 0.19 25)" },
];

export const LIFE_GRID_COLS = 52;
/** Initial scroll targets this many years before current age. */
export const LIFE_VIEW_YEARS_BEFORE = 15;

export function lifeViewStartAge(currentAge: number): number {
  return Math.max(0, currentAge - LIFE_VIEW_YEARS_BEFORE);
}

export function clampLifeSpanYears(years: number): number {
  return Math.min(Math.max(1, Math.floor(years)), LIFE_SPAN_MAX);
}

export function buildLifeWeeks(
  birthDate: string,
  spanYears: number = LIFE_SPAN_DEFAULT,
): LifeWeekSlot[] {
  const span = clampLifeSpanYears(spanYears);
  const birth = new Date(birthDate + "T00:00");
  const end = new Date(addYears(span, birthDate) + "T00:00");
  const weeks: LifeWeekSlot[] = [];
  const cur = new Date(birth);
  let weekIndex = 1;

  while (cur < end) {
    const days: string[] = [];
    const weekStart = iso(cur);
    for (let i = 0; i < 7; i++) {
      const day = new Date(cur);
      day.setDate(cur.getDate() + i);
      if (day >= end) break;
      days.push(iso(day));
    }
    if (!days.length) break;
    weeks.push({
      weekIndex,
      weekStart,
      weekEnd: days[days.length - 1]!,
      days,
    });
    weekIndex += 1;
    cur.setDate(cur.getDate() + 7);
  }

  return weeks;
}

/** Map any date in a life week to the grid's canonical weekStart (birth-aligned). */
export function resolveWeekSlotStart(
  date: string,
  gridWeeks: LifeWeekSlot[],
): string {
  const d = date.slice(0, 10);
  const slot = gridWeeks.find((w) => w.weekStart === d || w.days.includes(d));
  return slot?.weekStart ?? d;
}

/** Attach saved week memories to grid slots (tolerates legacy weekStart / weekEnd keys). */
export function buildLifeWeekMap(
  lifeWeeks: LifeWeek[],
  gridWeeks: LifeWeekSlot[],
): Map<string, LifeWeek> {
  const map = new Map<string, LifeWeek>();
  const assigned = new Set<string>();

  for (const slot of gridWeeks) {
    const exact = lifeWeeks.find(
      (w) => w.weekStart.slice(0, 10) === slot.weekStart && !assigned.has(w.id),
    );
    if (exact) {
      map.set(slot.weekStart, exact);
      assigned.add(exact.id);
      continue;
    }
    const inWeek = lifeWeeks.find(
      (w) =>
        !assigned.has(w.id) && slot.days.includes(w.weekStart.slice(0, 10)),
    );
    if (inWeek) {
      map.set(slot.weekStart, inWeek);
      assigned.add(inWeek.id);
    }
  }

  return map;
}

/** Up to LIFE_SPAN_MAX rows × 52 weeks — matches life calendar layout. */
export function buildLifeWeekGrid(
  birthDate: string,
  spanYears: number = LIFE_SPAN_DEFAULT,
  currentAge?: number,
): LifeWeekGrid {
  const span = clampLifeSpanYears(spanYears);
  const weeks = buildLifeWeeks(birthDate, span);
  const ageNow = currentAge ?? ageAt(birthDate, iso());
  const viewStart = lifeViewStartAge(ageNow);
  const birthYear = new Date(birthDate + "T00:00").getFullYear();

  const allRows: LifeCalendarRow[] = Array.from({ length: span }, (_, r) => {
    const cells = Array.from({ length: LIFE_GRID_COLS }, (_, col) => {
      const gi = r * LIFE_GRID_COLS + col;
      return weeks[gi] ?? null;
    });
    const isDecade = r % 10 === 0;
    const showYear = r % 5 === 0;
    return {
      age: r,
      cells,
      showAgeLabel: r % 5 === 0 || r === ageNow,
      ageEmphasis: isDecade || r === ageNow,
      yearLabel: showYear ? String(birthYear + r) : "",
      yearEmphasis: isDecade,
      decadeGap: isDecade && r > 0,
    };
  });

  return { weeks, rows: allRows, viewStartAge: viewStart };
}

export function computeLifeStats(
  birthDate: string,
  spanYears: number = LIFE_SPAN_DEFAULT,
  today: string = iso(),
): LifeStats {
  const span = clampLifeSpanYears(spanYears);
  const endDate = addYears(span, birthDate);
  const totalDays = daysBetween(birthDate, endDate);
  const livedDays = Math.min(
    Math.max(0, daysBetween(birthDate, today) + (today >= birthDate ? 1 : 0)),
    totalDays,
  );
  const leftDays = Math.max(0, totalDays - livedDays);
  const livedPct = totalDays ? Math.round((livedDays / totalDays) * 100) : 0;

  const weeks = buildLifeWeeks(birthDate, span);
  const totalWeeks = weeks.length;
  const livedWeeks = weeks.filter((w) => w.weekStart <= today).length;
  const leftWeeks = Math.max(0, totalWeeks - livedWeeks);
  const livedWeeksPct = totalWeeks
    ? Math.round((livedWeeks / totalWeeks) * 100)
    : 0;

  const ageYears = ageAt(birthDate, today);
  const ageLeftYears = Math.max(0, span - ageYears);

  return {
    totalDays,
    livedDays,
    leftDays,
    livedPct,
    totalWeeks,
    livedWeeks,
    leftWeeks,
    livedWeeksPct,
    ageYears,
    ageLeftYears,
    birthDate,
    endDate,
    today,
  };
}

export function moodColor(mood: LifeMood | null | undefined): string | null {
  if (!mood) return null;
  return LIFE_MOODS.find((m) => m.value === mood)?.color ?? null;
}

export type WeekCellState = "future" | "past" | "current";

export function weekCellState(
  weekStart: string,
  weekEnd: string,
  today: string = iso(),
): WeekCellState {
  if (today >= weekStart && today <= weekEnd) return "current";
  if (weekEnd < today) return "past";
  return "future";
}

export type DayCellState = "future" | "past" | "today";

export function dayCellState(
  date: string,
  today: string = iso(),
): DayCellState {
  if (date === today) return "today";
  if (date < today) return "past";
  return "future";
}

export function formatWeekRange(weekStart: string, weekEnd: string): string {
  const s = new Date(weekStart + "T00:00");
  const e = new Date(weekEnd + "T00:00");
  const sameMonth =
    s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();

  if (sameMonth) {
    const monthYear = e.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
    return `${s.getDate()} to ${e.getDate()} ${monthYear}`;
  }

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
  return `${fmt(s)} to ${fmt(e)} ${e.getFullYear()}`;
}

export function weekStatusLabel(
  weekStart: string,
  weekEnd: string,
  today: string = iso(),
): string {
  const state = weekCellState(weekStart, weekEnd, today);
  if (state === "current") return "this week";
  if (state === "past") return "lived";
  return "upcoming";
}
