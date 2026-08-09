import { iso } from "@/lib/date";

export const DEFAULT_BIRTH_DATE = "1999-01-01";

export type DatePickMode = "capture" | "due-optional" | "goal" | "birth";

export type DatePickConfig = {
  quickPicks: boolean;
  clearable: boolean;
  clearLabel: string;
  nullable: boolean;
  layout: "inline" | "field";
  navigation: "arrows" | "month-year";
  showJumpToday: boolean;
  fallbackValue: string;
  minYear: number;
  maxYear: number;
  displayFormat: "short" | "full";
};

const CURRENT_YEAR = new Date().getFullYear();

export const DATE_PICK_PRESETS: Record<DatePickMode, DatePickConfig> = {
  capture: {
    quickPicks: true,
    clearable: false,
    clearLabel: "Clear",
    nullable: false,
    layout: "inline",
    navigation: "arrows",
    showJumpToday: true,
    fallbackValue: iso(),
    minYear: CURRENT_YEAR - 1,
    maxYear: CURRENT_YEAR + 5,
    displayFormat: "short",
  },
  "due-optional": {
    quickPicks: true,
    clearable: true,
    clearLabel: "Clear",
    nullable: true,
    layout: "field",
    navigation: "month-year",
    showJumpToday: true,
    fallbackValue: iso(),
    minYear: CURRENT_YEAR - 5,
    maxYear: CURRENT_YEAR + 10,
    displayFormat: "short",
  },
  goal: {
    quickPicks: true,
    clearable: true,
    clearLabel: "Clear",
    nullable: true,
    layout: "field",
    navigation: "month-year",
    showJumpToday: true,
    fallbackValue: iso(),
    minYear: CURRENT_YEAR - 1,
    maxYear: CURRENT_YEAR + 15,
    displayFormat: "short",
  },
  birth: {
    quickPicks: false,
    clearable: false,
    clearLabel: "Clear",
    nullable: false,
    layout: "field",
    navigation: "month-year",
    showJumpToday: false,
    fallbackValue: DEFAULT_BIRTH_DATE,
    minYear: 1920,
    maxYear: CURRENT_YEAR,
    displayFormat: "full",
  },
};

export function resolveDatePickConfig(
  mode: DatePickMode,
  overrides: Partial<DatePickConfig> = {},
  timeZone?: string,
): DatePickConfig {
  const preset = { ...DATE_PICK_PRESETS[mode], ...overrides };
  if (timeZone && mode !== "birth" && overrides.fallbackValue === undefined) {
    preset.fallbackValue = iso(new Date(), timeZone);
  }
  return preset;
}

export function monthYearFromIso(isoDate: string): {
  year: number;
  month: number;
} {
  const d = new Date(isoDate.slice(0, 10) + "T00:00");
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function isoFromParts(
  year: number,
  month: number,
  day: number,
  timeZone?: string,
): string {
  const d = new Date(year, month, day);
  return iso(d, timeZone);
}

export function yearRange(min: number, max: number): number[] {
  const years: number[] = [];
  for (let y = max; y >= min; y--) years.push(y);
  return years;
}

export const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
