"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "@/components/icons";
import { addDays, formatDayFull, formatDayShort, iso } from "@/lib/date";
import {
  MONTH_LABELS,
  monthYearFromIso,
  resolveDatePickConfig,
  yearRange,
  type DatePickConfig,
  type DatePickMode,
} from "@/lib/date-pick";
import { cn } from "@/lib/utils";
import { useTimezone } from "@/components/shell/TimeZoneProvider";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type Props = {
  value: string | null;
  onChange: (due: string | null) => void;
  disabled?: boolean;
  /** Preset bundle — override individual flags below if needed */
  mode?: DatePickMode;
  quickPicks?: boolean;
  clearable?: boolean;
  clearLabel?: string;
  nullable?: boolean;
  layout?: "inline" | "field";
  navigation?: "arrows" | "month-year";
  showJumpToday?: boolean;
  fallbackValue?: string;
  minYear?: number;
  maxYear?: number;
  displayFormat?: "short" | "full";
  className?: string;
};

/**
 * The border NEVER changes width, and the transition never says "all".
 *
 * Selecting used to go `border` -> `border-2`. Because everything here is
 * border-box, the outer size stayed put while the painted inside was squeezed
 * by a pixel on each edge — and `transition-all` animated that squeeze, so a
 * chip appeared to shrink and recover every time you picked a date. The hard
 * offset shadow was animating in the same breath, growing out of the chip
 * towards its neighbour and then retracting.
 *
 * Now the second pixel of the active ring is an INSET shadow rather than a
 * fatter border, so geometry is identical in both states and only colour and
 * shadow move. Both are cheap and neither reflows.
 */
const chipBase =
  "rounded-lg border px-2 py-1 font-mono text-[11px] transition-[color,background-color,border-color,box-shadow] duration-150 ease-out disabled:pointer-events-none disabled:opacity-50";

const CHIP_ACTIVE_SHADOW =
  "shadow-[inset_0_0_0_1px_var(--primary),2px_2px_0_var(--primary)]";

function chipClass(active: boolean) {
  return cn(
    chipBase,
    active
      ? cn(
          "animate-chip-pick border-primary bg-primary/25 font-bold text-primary",
          CHIP_ACTIVE_SHADOW,
        )
      : "border-border bg-surface font-medium text-muted hover:border-faint hover:bg-surface2",
  );
}

function buildMonthCells(year: number, month: number, timeZone: string) {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const start = new Date(year, month, 1);
  start.setDate(1 - firstDow);

  return {
    monthLabel: new Date(year, month, 1).toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
    }),
    cells: Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return {
        ds: iso(d, timeZone),
        day: d.getDate(),
        inMonth: d.getMonth() === month,
      };
    }),
  };
}

function formatDisplay(date: string, format: DatePickConfig["displayFormat"]) {
  return format === "full" ? formatDayFull(date) : formatDayShort(date);
}

function selectClassName() {
  return cn(
    "min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1",
    "font-mono text-[11px] font-semibold text-ink outline-none",
    "focus:border-faint hover:border-faint",
  );
}

export function DueQuickPick({
  value,
  onChange,
  disabled,
  mode = "capture",
  quickPicks: quickPicksProp,
  clearable: clearableProp,
  clearLabel: clearLabelProp,
  nullable: nullableProp,
  layout: layoutProp,
  navigation: navigationProp,
  showJumpToday: showJumpTodayProp,
  fallbackValue: fallbackValueProp,
  minYear: minYearProp,
  maxYear: maxYearProp,
  displayFormat: displayFormatProp,
  className,
}: Props) {
  const timeZone = useTimezone();
  const config = resolveDatePickConfig(
    mode,
    {
      ...(quickPicksProp !== undefined ? { quickPicks: quickPicksProp } : {}),
      ...(clearableProp !== undefined ? { clearable: clearableProp } : {}),
      ...(clearLabelProp !== undefined ? { clearLabel: clearLabelProp } : {}),
      ...(nullableProp !== undefined ? { nullable: nullableProp } : {}),
      ...(layoutProp !== undefined ? { layout: layoutProp } : {}),
      ...(navigationProp !== undefined ? { navigation: navigationProp } : {}),
      ...(showJumpTodayProp !== undefined
        ? { showJumpToday: showJumpTodayProp }
        : {}),
      ...(fallbackValueProp !== undefined
        ? { fallbackValue: fallbackValueProp }
        : {}),
      ...(minYearProp !== undefined ? { minYear: minYearProp } : {}),
      ...(maxYearProp !== undefined ? { maxYear: maxYearProp } : {}),
      ...(displayFormatProp !== undefined
        ? { displayFormat: displayFormatProp }
        : {}),
    },
    timeZone,
  );

  const [open, setOpen] = useState(false);
  // Touch devices get the platform's own date picker — the custom popover is
  // a desktop affordance (and is awkward inside phone bottom sheets).
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
  }, []);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());

  const today = iso(new Date(), timeZone);
  const tomorrow = iso(addDays(1, new Date(), timeZone), timeZone);
  const selected = config.nullable ? value : (value ?? config.fallbackValue);
  const calendarFocus = selected ?? config.fallbackValue;
  const isCustom =
    selected !== null && selected !== today && selected !== tomorrow;
  const showDateLabel =
    Boolean(selected) &&
    (isCustom || !config.quickPicks || config.displayFormat === "full");

  const years = useMemo(
    () => yearRange(config.minYear, config.maxYear),
    [config.minYear, config.maxYear],
  );

  useEffect(() => {
    if (!open) return;
    const { year, month } = monthYearFromIso(calendarFocus);
    setViewYear(year);
    setViewMonth(month);
  }, [open, calendarFocus]);

  const { monthLabel, cells } = useMemo(
    () => buildMonthCells(viewYear, viewMonth, timeZone),
    [viewYear, viewMonth, timeZone],
  );

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const pickDate = (ds: string) => {
    onChange(ds);
    setOpen(false);
  };

  const calendarActive =
    isCustom || open || (config.nullable && selected === null && open);

  const inner = (
    <>
      {config.quickPicks && (
        <>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(today)}
            className={chipClass(selected === today)}
          >
            Today
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(tomorrow)}
            className={chipClass(selected === tomorrow)}
          >
            Tomorrow
          </button>
        </>
      )}
      {config.clearable && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          className={chipClass(selected === null)}
        >
          {config.clearLabel}
        </button>
      )}
      <div className="flex items-center gap-1">
        {coarse ? (
          <div className="relative">
            <button
              type="button"
              disabled={disabled}
              tabIndex={-1}
              className={cn(
                chipBase,
                "flex items-center justify-center px-1.5 py-1",
                calendarActive
                  ? cn("border-primary bg-primary/25 text-primary", CHIP_ACTIVE_SHADOW)
                  : "border-border bg-surface text-muted",
              )}
            >
              <Calendar
                className="h-3.5 w-3.5"
                strokeWidth={calendarActive ? 2.5 : 2}
              />
            </button>
            <input
              type="date"
              aria-label="Pick a date"
              disabled={disabled}
              value={selected ?? ""}
              onChange={(e) => {
                if (e.target.value) pickDate(e.target.value);
                else if (config.nullable) onChange(null);
              }}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                className={cn(
                  chipBase,
                  "flex items-center justify-center px-1.5 py-1",
                  calendarActive
                    ? cn("border-primary bg-primary/25 text-primary", CHIP_ACTIVE_SHADOW)
                    : "border-border bg-surface text-muted hover:border-faint hover:bg-surface2",
                )}
              >
                <Calendar
                  className="h-3.5 w-3.5"
                  strokeWidth={calendarActive ? 2.5 : 2}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[268px] p-0" align="start">
              <div className="border-b border-border2 px-3 py-2.5">
                {config.navigation === "month-year" ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => shiftMonth(-1)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:border-faint hover:bg-surface2"
                      aria-label="Previous month"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <select
                      aria-label="Month"
                      value={viewMonth}
                      onChange={(e) => setViewMonth(Number(e.target.value))}
                      className={selectClassName()}
                    >
                      {MONTH_LABELS.map((label, i) => (
                        <option key={label} value={i}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Year"
                      value={viewYear}
                      onChange={(e) => setViewYear(Number(e.target.value))}
                      className={cn(selectClassName(), "max-w-[76px]")}
                    >
                      {years.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => shiftMonth(1)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:border-faint hover:bg-surface2"
                      aria-label="Next month"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => shiftMonth(-1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted hover:border-faint hover:bg-surface2"
                      aria-label="Previous month"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="min-w-0 flex-1 truncate text-center text-[12px] font-bold text-ink">
                      {monthLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => shiftMonth(1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted hover:border-faint hover:bg-surface2"
                      aria-label="Next month"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                {config.showJumpToday && (
                  <button
                    type="button"
                    onClick={() => pickDate(today)}
                    className="mt-2 w-full rounded-lg border border-border bg-surface2 py-1 font-mono text-[10px] font-semibold text-muted hover:border-faint"
                  >
                    Jump to today
                  </button>
                )}
              </div>
              <div className="grid grid-cols-7 gap-0.5 px-2.5 pt-2">
                {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                  <div
                    key={`${d}-${i}`}
                    className="py-0.5 text-center font-mono text-[9px] font-medium text-faint2"
                  >
                    {d}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5 px-2.5 pb-3 pt-1">
                {cells.map((c) => {
                  const isSelected = selected !== null && c.ds === selected;
                  const isToday = c.ds === today;
                  return (
                    <button
                      key={c.ds}
                      type="button"
                      onClick={() => pickDate(c.ds)}
                      className={cn(
                        "flex h-8 w-full items-center justify-center rounded-lg border font-mono text-[11px] transition-[color,background-color,border-color,box-shadow] duration-150 ease-out",
                        isSelected
                          ? "animate-chip-pick border-primary bg-primary/20 font-bold text-primary shadow-[inset_0_0_0_1px_var(--primary),1px_1px_0_var(--primary)]"
                          : "border-transparent text-ink hover:border-border hover:bg-surface2",
                        !c.inMonth && !isSelected && "text-faint2",
                        isToday && !isSelected && "font-bold text-primary",
                      )}
                    >
                      {c.day}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}
        {showDateLabel && selected && (
          <span
            className="font-mono text-[11px] font-bold tabular-nums text-primary"
            title={selected}
          >
            {formatDisplay(selected, config.displayFormat)}
          </span>
        )}
      </div>
    </>
  );

  if (config.layout === "field") {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface2/50 p-2",
          className,
        )}
      >
        {inner}
      </div>
    );
  }

  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      {inner}
    </div>
  );
}
