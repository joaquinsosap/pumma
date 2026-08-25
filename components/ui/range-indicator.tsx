"use client";

import { cn } from "@/lib/utils";

/**
 * The "everything from there to here" marker, drawn while a shift-range is
 * being proposed but not yet taken.
 *
 * ## Why it is not a dashed line with an arrowhead marker
 *
 * The old one was `<line stroke-dasharray>` plus `markerEnd`. SVG places a
 * marker AT the endpoint of the line, and a dash pattern lands wherever the
 * maths puts it, so the final dash sat underneath the chevron and the two
 * smudged together at exactly the point the eye lands. Nudging `y2` only
 * moved the collision around, because the marker follows the endpoint.
 *
 * So there is no marker here. The spine and the head are separate shapes at
 * coordinates this component chooses, with a hard gap between them that no
 * dash can ever cross. The clipping is designed out rather than tuned out.
 *
 * ## The shape
 *
 * - A **dot at the origin**, because a range has two ends and the old one
 *   started in mid-air — you could see where it was going and not where it
 *   came from.
 * - A **spine of travelling dots** rather than a static dashed border. The
 *   dash offset animates, so it reads as flowing from the anchor towards the
 *   pointer: direction is shown by motion instead of being left to the
 *   arrowhead alone.
 * - A **chevron head** as its own polyline, round-joined, that bobs very
 *   slightly. Two pixels is enough to make it read as pointing rather than
 *   parked.
 *
 * Everything is stroke-based and sized from one number, so it scales to any
 * row height without re-tuning.
 */

/** Pulled inside the two rows so the ends never touch their text. */
const INSET = 13;
/** Clear air between the last dot and the chevron. The anti-smudge. */
const HEAD_GAP = 10;
const W = 18;
const CX = W / 2;

export function RangeIndicator({
  /** Distance in px between the two row centres. */
  span,
  className,
  style,
  /**
   * Which way it points. The arrow runs FROM the anchor TO the pointer, so
   * hovering above the selected row must point up — drawing it downwards
   * regardless said "from the top one to the bottom one", which is not the
   * question being asked and is backwards half the time.
   */
  direction = "down",
  ink = "color-mix(in oklch, var(--primary) 55%, var(--ink))",
}: {
  span: number;
  className?: string;
  style?: React.CSSProperties;
  direction?: "down" | "up";
  ink?: string;
}) {
  const y0 = INSET;
  const headY = span - INSET;
  const spineEnd = headY - HEAD_GAP;
  // Too short to be worth drawing: the head alone would sit on the origin dot.
  if (spineEnd - y0 < 4) return null;

  return (
    <svg
      className={cn("pointer-events-none overflow-visible", className)}
      // Mirrored rather than re-derived: the shape is symmetric, so flipping
      // it puts the origin dot at the pointer end and the head at the other
      // with no second set of coordinates to keep in step. The head's bob is
      // inside the flip, so it still nods towards where it points.
      style={{
        ...style,
        transform:
          direction === "up"
            ? `scaleY(-1)${style?.transform ? ` ${style.transform}` : ""}`
            : style?.transform,
      }}
      width={W}
      height={headY + 6}
      aria-hidden
    >
      {/* The origin. Small, solid, and the only filled thing here. */}
      <circle cx={CX} cy={y0} r="2.4" style={{ fill: ink }} />

      {/* The stream. `2 6` with round caps reads as dots in motion; a longer
          dash reads as a border someone forgot to finish. */}
      <line
        x1={CX}
        y1={y0 + 5}
        x2={CX}
        y2={spineEnd}
        style={{ stroke: ink }}
        strokeWidth="2.4"
        strokeDasharray="2 6"
        strokeLinecap="round"
        className="range-flow"
      />

      {/* The head, at coordinates we chose. Nothing auto-places it, so
          nothing can land under it. */}
      <polyline
        points={`${CX - 5},${headY - 5} ${CX},${headY} ${CX + 5},${headY - 5}`}
        fill="none"
        style={{ stroke: ink }}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="range-head"
      />
    </svg>
  );
}
