"use client";

import { cn } from "@/lib/utils";
import { habitScheduleLabel } from "@/lib/habit-visibility";
import type { WeekStart } from "@/lib/date";

const NAMES = ["S", "M", "T", "W", "T", "F", "S"];
const ORDER: Record<WeekStart, number[]> = {
  mon: [1, 2, 3, 4, 5, 6, 0],
  sun: [0, 1, 2, 3, 4, 5, 6],
};

const PRESETS: { label: string; days: number[] }[] = [
  { label: "Every day", days: [] },
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Weekend", days: [0, 6] },
];

/**
 * Which days of the week a daily habit runs on.
 *
 * Only shown for daily habits: a weekly or monthly habit has no weekday to
 * pick, and offering one would imply a rule nothing enforces.
 *
 * Selecting none is the same as selecting all — a habit that runs on no days
 * is not a habit — so the picker refuses to empty itself and the last day
 * standing cannot be turned off.
 */
export function HabitDayPicker({
  days,
  weekStart = "mon",
  onChange,
  disabled,
}: {
  days: number[] | undefined;
  weekStart?: WeekStart;
  onChange: (days: number[]) => void;
  disabled?: boolean;
}) {
  const selected = new Set(days?.length ? days : [0, 1, 2, 3, 4, 5, 6]);
  const all = !days?.length || days.length === 7;

  const toggle = (d: number) => {
    const next = new Set(selected);
    if (next.has(d)) {
      if (next.size === 1) return;
      next.delete(d);
    } else {
      next.add(d);
    }
    onChange([...next].sort((a, b) => a - b));
  };

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <div className="flex gap-1">
        {ORDER[weekStart].map((d, i) => {
          const on = !all && selected.has(d);
          return (
            <button
              key={`${d}-${i}`}
              type="button"
              disabled={disabled}
              onClick={() => toggle(d)}
              aria-pressed={on}
              aria-label={
                [
                  "Sunday",
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                ][d]
              }
              className={cn(
                "h-[22px] w-[22px] rounded-md border font-mono text-[10px] font-semibold transition-colors",
                on || all
                  ? "border-habits bg-habits/15 text-habits"
                  : "border-border text-faint2 hover:border-faint2 hover:text-muted",
              )}
            >
              {NAMES[d]}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            disabled={disabled}
            onClick={() => onChange(p.days)}
            className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[9.5px] text-faint transition-colors hover:border-faint2 hover:text-muted"
          >
            {p.label}
          </button>
        ))}
      </div>
      <span className="font-mono text-[9.5px] text-faint2">
        {habitScheduleLabel({ type: "daily", target: 1, days })}
      </span>
    </div>
  );
}
