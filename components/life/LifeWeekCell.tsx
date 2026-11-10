"use client";

import { memo } from "react";
import type { LifeMood } from "@/lib/schemas";
import { moodColor, weekCellState } from "@/lib/life-calendar";
import { Star } from "@/components/icons";
import { cn } from "@/lib/utils";

type Props = {
  weekStart: string;
  weekEnd: string;
  weekIndex: number;
  today: string;
  mood?: LifeMood | null;
  hasNote?: boolean;
  /** A birthday falls in this week. */
  hasBirthday?: boolean;
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
  hasBirthday = false,
  fullView = false,
  onSelect,
}: Props) {
  const state = weekCellState(weekStart, weekEnd, today);
  const mc = moodColor(mood);
  // Full view's cells are too small for a glyph, so a birthday week takes the star's colour instead; a mood or the current week still wins.
  const birthdayFill = hasBirthday && fullView && !mc && state !== "current";
  const showStar = hasBirthday && !fullView;

  return (
    <button
      type="button"
      title={hasBirthday ? `Week ${weekIndex}, birthday` : `Week ${weekIndex}`}
      onClick={() => onSelect(weekStart)}
      className={cn(
        "flex min-w-0 flex-1 cursor-pointer items-center justify-center",
        showStar && "relative",
        // Wraps to 26-per-line on a phone; see .life-week-cell in globals.
        !fullView && "life-week-cell",
        // Square, and the same square either way. These are weeks of a life
        // and there are four and a half thousand of them: at eleven pixels a
        // rounded corner is not a corner, it is a smudge, and it made the
        // grid read as a mesh of dots rather than a block of time.
        fullView ? "h-full min-h-[2px]" : "h-[11px] sm:h-3.5",
        // Filled either way too. The weeks ahead used to be an outline while
        // the weeks behind were a fill, so half the grid was drawn one way
        // and half the other, and the join between them read as a change of
        // material rather than a point in a life. Now it is one form in two
        // weights, which is what it is.
        // The week you are in, found by colour AND by shape.
        //
        // It used to be a 1.5px accent outline drawn inside a lived-coloured
        // square, and in this theme the accent and the lived colour are the
        // same blue — so the one cell anybody actually looks for was the one
        // cell that could not be seen. Now it takes a warm fill that nothing
        // else in the grid uses, and a ring that sits in the gap between
        // squares, breaking the rhythm of the mesh. Four and a half thousand
        // identical squares hide a recoloured one surprisingly well; they
        // cannot hide one that is the wrong size.
        // The outline and the pulse both live in `.life-now`. They used to be
        // Tailwind ring utilities here, which never drew a single pixel:
        // rings ARE box-shadow, and the pulse animates box-shadow, so every
        // frame of the animation overwrote the ring. The cell that exists to
        // be findable was findable by colour alone. See globals.css.
        state === "current" &&
          cn("life-now relative z-10", fullView && "life-now-tight"),
        !mc &&
          !birthdayFill &&
          cn(state === "past" && "bg-lived", state === "future" && "bg-ahead"),
        birthdayFill && "bg-amber-500",
        state === "current" && !mc && "bg-[var(--life-now)]",
      )}
      style={mc ? { background: mc } : undefined}
    >
      {showStar && (
        <Star
          aria-hidden
          fill="currentColor"
          strokeWidth={0}
          className={cn(
            "h-[9px] w-[9px] shrink-0 sm:h-[11px] sm:w-[11px]",
            // Amber is lost on a mood fill and on the current week's orange.
            mc
              ? "text-white"
              : state === "current"
                ? "text-surface"
                : "text-amber-500",
          )}
        />
      )}
      {hasNote && (
        <span
          className={cn(
            fullView ? "h-[2px] w-[2px]" : "h-[3px] w-[3px]",
            "rounded-full",
            // Beside a star the dot moves to the corner, so both read.
            showStar && "absolute right-px top-px",
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
        !fullView && "life-week-cell",
        fullView ? "h-full min-h-[2px]" : "h-[11px] sm:h-3.5",
      )}
      aria-hidden
    />
  );
});
