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
        // Square, and the same square either way. These are weeks of a life
        // and there are four and a half thousand of them: at eleven pixels a
        // rounded corner is not a corner, it is a smudge, and it made the
        // grid read as a mesh of dots rather than a block of time.
        fullView ? "h-full min-h-[2px]" : "h-2.5 sm:h-3.5",
        // Filled either way too. The weeks ahead used to be an outline while
        // the weeks behind were a fill, so half the grid was drawn one way
        // and half the other, and the join between them read as a change of
        // material rather than a point in a life. Now it is one form in two
        // weights, which is what it is.
        !mc &&
          cn(
            state === "past" && "bg-lived",
            state === "future" && "bg-ahead",
            state === "current" &&
              (fullView
                ? "bg-lived ring-1 ring-inset ring-primary"
                : "bg-lived outline outline-[1.5px] outline-primary -outline-offset-1"),
          ),
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
        "min-w-0 flex-1 bg-ahead",
        fullView ? "h-full min-h-[2px]" : "h-2.5 sm:h-3.5",
      )}
      aria-hidden
    />
  );
});
