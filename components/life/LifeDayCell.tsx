"use client";

import { memo } from "react";
import type { LifeMood } from "@/lib/schemas";
import { dayCellState, moodColor } from "@/lib/life-calendar";
import { cn } from "@/lib/utils";

type Props = {
  date: string;
  today: string;
  mood?: LifeMood | null;
  hasNote?: boolean;
  hasTasks?: boolean;
  onSelect: (date: string) => void;
};

export const LifeDayCell = memo(function LifeDayCell({
  date,
  today,
  mood,
  hasNote,
  hasTasks,
  onSelect,
}: Props) {
  const state = dayCellState(date, today);
  const mc = moodColor(mood);
  const marked = hasNote || hasTasks;

  return (
    <button
      type="button"
      title={date}
      onClick={() => onSelect(date)}
      className={cn(
        "shrink-0 rounded-[1px] transition-transform hover:scale-150 hover:z-20",
        "h-[5px] w-[5px] sm:h-1.5 sm:w-1.5",
        state === "future" && "bg-border2/50",
        state === "past" && !mc && "bg-faint2/70",
        state === "today" &&
          "z-10 h-2 w-2 ring-2 ring-primary ring-offset-1 ring-offset-surface sm:h-2.5 sm:w-2.5",
        marked && state !== "future" && "ring-1 ring-ink/25",
        mc && state === "past" && "ring-0",
      )}
      style={mc && state === "past" ? { background: mc } : undefined}
    />
  );
});
