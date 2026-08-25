"use client";

import type { TaskPriority } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Short enough to sit in a list row without stealing space from the title. */
export const PRIORITY_SHORT: Record<TaskPriority, string> = {
  high: "HIGH",
  med: "MID",
  low: "LOW",
};

/**
 * Three priorities that read as a ramp of urgency, not three unrelated hues.
 *
 * High and mid used to be 25 and 70 — only 45 degrees apart, both warm, and
 * close in lightness, so at fifteen pixels they were two shades of the same
 * orange-red and told you nothing apart. Mid moved to 92, plainly yellow-gold
 * and 67 degrees clear of high; high went deeper and more saturated so it is
 * the loudest of the three. Low keeps the calendar's cool blue, which is quiet
 * on purpose.
 */
export const PRIORITY_COLOR: Record<TaskPriority, string> = {
  high: "var(--prio-high)",
  med: "var(--prio-med)",
  low: "var(--prio-low)",
};

/**
 * The glyph's own colour inside the tinted box.
 *
 * Darker than the tint it sits on, because the box carries the hue and the
 * glyph only has to be legible. Mid especially: yellow at full brightness is
 * nearly invisible as text on a light ground.
 */
export const PRIORITY_INK: Record<TaskPriority, string> = {
  high: "var(--prio-high-ink)",
  med: "var(--prio-med-ink)",
  low: "var(--prio-low-ink)",
};

/**
 * The word form. Same three colours as the boxed glyph, through the same
 * variables, so the wide and narrow forms of one priority never disagree.
 */
const CHIP: Record<TaskPriority, string> = {
  high: "border-[color-mix(in_oklab,var(--prio-high)_45%,transparent)] bg-[color-mix(in_oklab,var(--prio-high)_12%,transparent)] text-[var(--prio-high-ink)]",
  med: "border-[color-mix(in_oklab,var(--prio-med)_50%,transparent)] bg-[color-mix(in_oklab,var(--prio-med)_15%,transparent)] text-[var(--prio-med-ink)]",
  low: "border-[color-mix(in_oklab,var(--prio-low)_40%,transparent)] bg-[color-mix(in_oklab,var(--prio-low)_10%,transparent)] text-[var(--prio-low-ink)]",
};

/**
 * Lineless arrowheads rather than stemmed arrows — U+2303/U+2304, with an en
 * dash holding the middle. All three are one glyph wide in JetBrains Mono, so
 * the column doesn't twitch as a task changes priority.
 *
 * Each needs its own nudge because the caret sits high in its em box and the
 * chevron low: flex centring centres the box, not the ink, so without these
 * the caret crowds the top border and the chevron the bottom.
 *
 * The numbers are measured, not eyeballed. Rendering each glyph to a canvas
 * at 10x and finding the alpha bounds puts the caret's ink 3.1px above the
 * line box's centre and the chevron's 2.8px below, at this font size. The
 * dash was already centred to within 0.1px and is left alone. Earlier values
 * of 1 and 1.5 were guesses, and both under-corrected by about two pixels —
 * which is most of an 18px box.
 */
const GLYPH_NUDGE: Record<TaskPriority, string> = {
  high: "translate-y-[3px]",
  med: "",
  low: "-translate-y-[2.8px]",
};

export const PRIORITY_GLYPH: Record<TaskPriority, string> = {
  high: "\u2303",
  med: "\u2013",
  low: "\u2304",
};

/**
 * The priority of a task, said out loud.
 *
 * Two forms in one element: the word on roomy layouts, and a bare arrow where
 * the row is too narrow to spend ~34px on a label — up for high, a flat dash
 * for mid, down for low. Which one shows is CSS, following the same
 * `.task-tag-full` / `.task-tag-mini` swap the rows already use, so the parent
 * decides by width without this component knowing anything about the viewport.
 *
 * Renders as a button when `onCycle` is given and a plain span otherwise —
 * some rows are wrapped in a link, where a nested button is invalid.
 */
export function PriorityChip({
  priority,
  onCycle,
  dimmed,
  className,
}: {
  priority: TaskPriority;
  onCycle?: () => void;
  dimmed?: boolean;
  className?: string;
}) {
  const label = PRIORITY_SHORT[priority];

  const body = (
    <>
      <span
        className={cn(
          "task-prio-text rounded-[4px] border px-1 py-[1px] font-mono text-[8.5px] font-bold leading-[13px] tracking-[0.06em] max-sm:hidden",
          CHIP[priority],
        )}
      >
        {label}
      </span>
      {/* The narrow form. A bare arrowhead read as stray punctuation; the
          tinted box gives it a surface, so it reads as a state the row is in
          rather than a character that wandered in. The tint carries the hue
          and the glyph goes darker, because the border alone was not enough
          to make it look deliberate. */}
      <span
        aria-hidden
        className={cn(
          "task-prio-icon hidden size-[18px] items-center justify-center rounded-[4px] border font-mono text-[11px] leading-none max-sm:inline-flex",
        )}
        style={{
          color: PRIORITY_INK[priority],
          borderColor: `color-mix(in oklab, ${PRIORITY_COLOR[priority]} 45%, transparent)`,
          background: `color-mix(in oklab, ${PRIORITY_COLOR[priority]} 15%, transparent)`,
        }}
      >
        <span className={cn("block", GLYPH_NUDGE[priority])}>
          {PRIORITY_GLYPH[priority]}
        </span>
      </span>
    </>
  );

  const classes = cn(
    "shrink-0 transition-colors",
    dimmed && "opacity-45",
    className,
  );

  if (!onCycle) {
    return (
      <span className={classes} aria-label={`Priority ${label}`}>
        {body}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onCycle();
      }}
      title={`Priority: ${label}, click to change`}
      aria-label={`Priority ${label}`}
      className={cn(classes, "hover:brightness-95")}
    >
      {body}
    </button>
  );
}
