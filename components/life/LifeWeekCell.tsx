"use client";

import { memo } from "react";
import type { LifeMood } from "@/lib/schemas";
import { moodColor, weekCellState } from "@/lib/life-calendar";
import { cn } from "@/lib/utils";

type Props = {
  weekStart: string;
  weekEnd: string;
  weekIndex: number;
  today: string;
  mood?: LifeMood | null;
  hasNote?: boolean;
  fullView?: boolean;
  onSelect: (weekStart: string) => void;
};

export const LifeWeekCell = memo(function LifeWeekCell({
  weekStart,
  weekEnd,
  weekIndex,
  today,
  mood,
  hasNote,
  fullView = false,
  onSelect,
}: Props) {
  const state = weekCellState(weekStart, weekEnd, today);
  const mc = moodColor(mood);

  return (
    <button
      type="button"
      title={`Week ${weekIndex}`}
      onClick={() => onSelect(weekStart)}
      className={cn(
        "flex min-w-0 flex-1 cursor-pointer items-center justify-center",
        fullView
          ? "h-full min-h-[2px] rounded-[1px]"
          : "h-2.5 rounded-[2px] sm:h-3.5",
        !mc &&
          (fullView
            ? cn(
                state === "past" && "bg-lived",
                state === "future" && "bg-ahead",
                state === "current" &&
                  "bg-lived ring-1 ring-inset ring-primary",
              )
            : cn(
                state === "past" && "bg-lived",
                state === "future" && "border border-border2 bg-transparent",
                state === "current" &&
                  "bg-primary/[0.18] outline outline-[1.5px] outline-primary -outline-offset-1",
              )),
        mc &&
          state === "current" &&
          (fullView
            ? "ring-1 ring-inset ring-primary"
            : "outline outline-[1.5px] outline-primary -outline-offset-1"),
      )}
      style={mc ? { background: mc } : undefined}
    >
      {hasNote && (
        <span
          className={cn(
            fullView ? "h-[2px] w-[2px]" : "h-[3px] w-[3px]",
            "rounded-full",
            mc
              ? "bg-white/90"
              : fullView
                ? state === "past"
                  ? "bg-ink/40"
                  : "bg-faint"
                : state === "past"
                  ? "bg-ink/50"
                  : "bg-muted",
          )}
        />
      )}
    </button>
  );
});

export const LifeWeekEmpty = memo(function LifeWeekEmpty({
  fullView = false,
}: {
  fullView?: boolean;
}) {
  return (
    <span
      className={cn(
        "min-w-0 flex-1",
        fullView
          ? "h-full min-h-[2px] rounded-[1px] bg-ahead"
          : "h-2.5 rounded-[2px] border border-border2 bg-transparent sm:h-3.5",
      )}
      aria-hidden
    />
  );
});
