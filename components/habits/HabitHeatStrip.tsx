"use client";

import type { Habit } from "@/lib/schemas";
import { iso, type WeekStart } from "@/lib/date";
import { useTimezone } from "@/components/shell/TimeZoneProvider";
import {
  habitHeatCells,
  normalizeHabitFrequency,
  type HabitHeatCell,
  type HabitVisibilitySettings,
} from "@/lib/habit-visibility";
import { cn } from "@/lib/utils";

type Props = {
  habit: Habit;
  entries: Set<string>;
  visibility: HabitVisibilitySettings;
  weekStart?: WeekStart;
  today?: string;
  onToggleCell?: (cell: HabitHeatCell) => void;
  compact?: boolean;
  className?: string;
};

const DONE_BG = "oklch(0.6 0.13 155)";

/** Single-letter weekday for a YYYY-MM-DD, Sunday-indexed like getDay(). */
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"] as const;
function weekdayLetter(isoDate: string): string {
  return WEEKDAY_LETTERS[new Date(isoDate + "T00:00").getDay()];
}

function isWeekend(isoDate: string): boolean {
  const d = new Date(isoDate + "T00:00").getDay();
  return d === 0 || d === 6;
}

function monthShort(isoDate: string): string {
  return new Date(isoDate + "T00:00").toLocaleDateString("en-US", {
    month: "short",
  });
}

/**
 * History for one habit: a single run of boxes, oldest → newest.
 *
 * Every cadence reads the same way — each box carries the number it stands for
 * (day of month / week's starting day / month), and the month is captioned
 * above the box that starts it, with a little air before it. That's what makes
 * it possible to tell which box you're about to click; it used to be an
 * unlabelled run of identical squares with only a hover tooltip.
 */
export function HabitHeatStrip({
  habit,
  entries,
  visibility,
  weekStart = "mon",
  today,
  onToggleCell,
  compact = false,
  className,
}: Props) {
  const timeZone = useTimezone();
  const td = today ?? iso(new Date(), timeZone);
  const frequency = normalizeHabitFrequency(habit.frequency.type);
  const cells = habitHeatCells(
    frequency,
    visibility,
    entries,
    weekStart,
    td,
    timeZone,
    habit.frequency,
  );

  // Only slightly bigger than the original bare squares — just enough for a
  // number to sit legibly inside.
  const size =
    frequency === "monthly"
      ? compact
        ? "h-5 min-w-[38px] px-1"
        : "h-6 min-w-[44px] px-1.5"
      : frequency === "weekly"
        ? compact
          ? "h-5 min-w-[26px] px-1"
          : "h-6 min-w-[30px] px-1"
        : compact
          ? "h-[17px] min-w-[17px]"
          : "h-5 min-w-[20px]";

  const labelFor = (cell: HabitHeatCell) =>
    frequency === "monthly"
      ? cell.label.split(" ")[0]
      : // daily + weekly both key off the cell's own date
        String(Number(cell.id.slice(8, 10)));

  return (
    <div
      className={cn(
        "flex flex-wrap items-end",
        frequency === "daily" ? "gap-x-1 gap-y-1.5" : "gap-1.5",
        className,
      )}
    >
      {cells.map((cell, index) => {
        const prev = cells[index - 1];
        // Monthly boxes already say the month — no caption needed.
        const showMonth =
          frequency !== "monthly" &&
          (index === 0 || !prev || monthShort(prev.id) !== monthShort(cell.id));

        // A day the schedule skips keeps its slot and gives up everything
        // else: no fill, no border, no number, nothing to press. The run has
        // to stay a calendar — take the box out and every date after it
        // shifts, and the week you are looking for is no longer where your
        // eye expects it.
        const box = cn(
          size,
          "flex w-full items-center justify-center rounded-[4px]",
          onToggleCell &&
            cell.applies &&
            "cursor-pointer hover:outline hover:outline-2 hover:outline-faint2 hover:outline-offset-1",
        );
        const style: React.CSSProperties = cell.applies
          ? {
              background: cell.done ? DONE_BG : "var(--border2)",
              border: cell.done ? "none" : "1px solid var(--border)",
              outline: cell.isCurrent ? "2px solid var(--faint2)" : undefined,
              outlineOffset: cell.isCurrent ? "1px" : undefined,
            }
          : { background: "transparent", border: "none" };
        const content = (
          <span
            className={cn(
              "font-mono tabular-nums leading-none",
              frequency === "daily"
                ? compact
                  ? "text-[7px]"
                  : "text-[8.5px]"
                : compact
                  ? "text-[8.5px]"
                  : "text-[9.5px]",
              cell.done ? "font-bold text-white" : "text-faint",
            )}
          >
            {cell.applies ? labelFor(cell) : ""}
          </span>
        );
        const title = !cell.applies
          ? `${cell.id} · not a day this habit runs on`
          : frequency === "daily"
            ? `${cell.id}${cell.isCurrent ? " · today" : ""}`
            : cell.label;

        return (
          <div
            key={cell.id}
            className={cn(
              "flex shrink-0 flex-col gap-0.5",
              // A little air where the month turns over, so the run reads in
              // month-sized chunks.
              showMonth &&
                index > 0 &&
                (frequency === "daily" ? "ml-2" : "ml-2.5"),
            )}
          >
            {frequency !== "monthly" && (
              <span
                className={cn(
                  "font-mono uppercase tracking-wide text-faint2",
                  compact
                    ? "text-[7px] leading-[10px]"
                    : "text-[8px] leading-3",
                )}
              >
                {showMonth ? monthShort(cell.id) : ""}
              </span>
            )}
            {onToggleCell && cell.applies ? (
              <button
                type="button"
                title={title}
                aria-label={title}
                onClick={() => onToggleCell(cell)}
                className={box}
                style={style}
              >
                {content}
              </button>
            ) : (
              <span title={title} className={box} style={style}>
                {content}
              </span>
            )}
            {frequency === "daily" && (
              <span
                aria-hidden
                className={cn(
                  "text-center font-mono leading-none",
                  compact ? "text-[6.5px]" : "text-[7.5px]",
                  // Weekends sit back a shade so the week's shape is readable
                  // at a glance without adding another visual element.
                  isWeekend(cell.id) ? "text-faint2/60" : "text-faint2",
                )}
              >
                {weekdayLetter(cell.id)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
