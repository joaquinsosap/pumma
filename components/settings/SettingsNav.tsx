"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The index down the left of Settings.
 *
 * Eleven panels in one scroll with no structure meant the only way to find a
 * setting was to read all of them. Grouping them is most of the fix; this is
 * the part that shows the grouping and lets you jump.
 *
 * No boxes and no words: each group is a bar whose LENGTH is the marker. The
 * one you are in is longest and takes the accent, its neighbours are a little
 * longer than the rest, so the column has a shape you can read from the
 * corner of your eye without reading anything. An earlier version made every
 * marker loud to be findable and read as a column of stray checkboxes; the
 * fix was to make the ACTIVE one loud instead.
 *
 * Hovering a tick names it, and only it, right under that tick. One label at
 * a time is the point: six would undo the quiet the lengths buy. The caption
 * is absolutely positioned, so naming a tick never moves the ticks, and it
 * overhangs the rail into the gutter rather than widening the column.
 *
 * The hovered tick also grows to the length of the selected one while keeping
 * its own colour: halfway to selected, which is what pointing at something
 * is.
 */
export type SettingsGroup = {
  id: string;
  /** Spelled out. Not rendered yet: the rail is markers only for now. */
  label: string;
  short: string;
};

/** Bar length by distance from the group you are in. */
function tickWidth(distance: number): number {
  if (distance === 0) return 28;
  if (distance === 1) return 20;
  return 14;
}

export function SettingsNav({
  groups,
  scrollerRef,
  className,
}: {
  groups: SettingsGroup[];
  /** The pane that actually scrolls; the page body does not. */
  scrollerRef: React.RefObject<HTMLElement | null>;
  className?: string;
}) {
  const [active, setActive] = useState(groups[0]?.id ?? "");
  const [hovered, setHovered] = useState<string | null>(null);

  /**
   * Scrollspy: whichever group's heading last crossed the trigger line.
   *
   * This was an IntersectionObserver over a narrow band near the top, taking
   * the first group reported as intersecting. Two things were wrong with that,
   * and they compounded.
   *
   * A group taller than the band intersects it for the whole time it takes to
   * scroll past. While the next group's top is already inside the band, the
   * previous one's bottom still is too, and "first in document order" keeps
   * choosing the previous one. So scrolling DOWN changed late.
   *
   * Scrolling UP is the mirror image: the group above re-enters the band and
   * is immediately first, so it changed early. Late one way and early the
   * other means the marker never lines up with what you are reading, and
   * around short groups it can appear to skip one entirely.
   *
   * Comparing positions to a single line has neither problem. The active group
   * is the last one whose top has passed the line, which is the same answer
   * going up as coming down, and a short group gets its turn on the way past
   * exactly as a tall one does.
   */
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      // A little below the top of the pane, so a group takes the marker as its
      // heading arrives rather than when it has already filled the view.
      const line =
        root.getBoundingClientRect().top +
        Math.min(140, root.clientHeight * 0.28);

      let current = groups[0]?.id ?? "";
      for (const g of groups) {
        const el = document.getElementById(g.id);
        if (el && el.getBoundingClientRect().top <= line) current = g.id;
      }

      // The last group is usually too short to reach the line: there is
      // nothing below it to push it up there, so the bottom of the scroll
      // would otherwise leave the previous group marked.
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 24) {
        const last = groups[groups.length - 1];
        if (last) current = last.id;
      }

      // Only on a real change: this runs on every scroll frame.
      setActive((prev) => (prev === current ? prev : current));
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    root.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      root.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [groups, scrollerRef]);

  const activeIndex = Math.max(
    0,
    groups.findIndex((g) => g.id === active),
  );

  return (
    <nav
      className={cn("relative w-[40px]", className)}
      aria-label="Settings sections"
      onMouseLeave={() => setHovered(null)}
    >
      {/* No gap. The rows sit flush and carry their spacing as padding
          instead, so the whole column is hit area and there is no dead strip
          between one tick and the next. The rhythm is unchanged: a 34px row
          with the bar centred puts the bars the same distance apart as a 16px
          row plus an 18px gap did. */}
      <ul className="flex flex-col items-stretch">
        {groups.map((g, i) => {
          const isActive = g.id === active;
          const isHovered = g.id === hovered;
          return (
            <li key={g.id} className="relative flex">
              <button
                type="button"
                aria-current={isActive ? "true" : undefined}
                aria-label={g.label}
                title={g.label}
                onMouseEnter={() => setHovered(g.id)}
                onFocus={() => setHovered(g.id)}
                onBlur={() => setHovered(null)}
                onClick={(e) => {
                  document
                    .getElementById(g.id)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  e.currentTarget.blur();
                }}
                // The bar is 4px tall and at most 28px wide. Hitting THAT was
                // the control, which meant most of the column did nothing and
                // a label only appeared once you had already landed on the
                // bar. The button now takes the full width of the rail and the
                // full height of its row, so pointing anywhere on the line
                // works and moving down the column never passes through a gap.
                className="group relative flex h-[34px] w-full items-center py-0"
              >
                <span
                  className="block h-[4px] rounded-full transition-all duration-200 ease-out motion-reduce:transition-none"
                  style={{
                    // Pointing at a tick gives it the selected length while
                    // it keeps its own colour, so the gesture reads as "this
                    // one, if you want it" rather than as a second selection.
                    width:
                      isHovered && !isActive
                        ? tickWidth(0)
                        : tickWidth(Math.abs(i - activeIndex)),
                    background: isActive
                      ? "var(--primary)"
                      : isHovered
                        ? "color-mix(in oklab, var(--primary) 55%, transparent)"
                        : `color-mix(in oklab, var(--ink) ${
                            Math.abs(i - activeIndex) === 1 ? 34 : 22
                          }%, transparent)`,
                  }}
                />
                {/* INSIDE the button, deliberately.

                    As a sibling with pointer-events-none it was a label you
                    could read and not press: the obvious thing to do once a
                    word appears is click the word. Worse, it overhangs the
                    40px rail, so reaching for it left the nav's box and the
                    mouseleave wiped the hover before you arrived. As a
                    descendant it inherits the button's click and cannot
                    trigger that mouseleave — DOM hover follows the element
                    tree, not the geometry, so the overhang is free.

                    Pointer events only while it is actually visible: an
                    invisible label would otherwise sit in the gutter eating
                    clicks meant for the page. */}
                <span
                  aria-hidden
                  className={cn(
                    // Tailwind v4 emits translate-y-* as the `translate`
                    // property, not `transform`: transitioning "transform"
                    // here names a property nothing animates, and it snaps.
                    // Anchored to the middle of the row rather than its
                    // bottom, so it sits just under the BAR. Now that the row
                    // is the full 34px, "bottom of the button" is most of a
                    // line away from the tick it belongs to.
                    "absolute left-0 top-1/2 z-10 mt-[7px] whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.1em] transition-[opacity,translate,color] duration-200 ease-out motion-reduce:transition-none motion-reduce:translate-none",
                    // It settles into place rather than blinking on: a couple
                    // of pixels of travel is what makes a label read as
                    // arriving. The delay is only on the way IN, so sweeping
                    // the pointer down the rail does not strobe six captions,
                    // while leaving is instant and never lags the mouse.
                    isHovered
                      ? "pointer-events-auto translate-y-0 cursor-pointer opacity-100 delay-[70ms]"
                      : "pointer-events-none -translate-y-[3px] opacity-0 delay-0",
                    isActive ? "text-primary" : "text-faint",
                  )}
                >
                  {g.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A titled band of panels, and the thing the nav scrolls to. */
export function SettingsGroupBlock({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-faint">
          {label}
        </h2>
        <span className="h-px flex-1 bg-border" aria-hidden />
      </div>
      {children}
    </section>
  );
}
