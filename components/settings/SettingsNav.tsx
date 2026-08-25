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
 * Hovering a tick names it, and only it, in a caption pinned under the
 * stack. One label at a time is the point: six would undo the quiet the
 * lengths buy. The caption is absolutely positioned so the ticks never move
 * when it appears, and it reads downward like everything else in this column.
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

  // Scrollspy. rootMargin pulls the trigger line up near the top of the pane,
  // so a group becomes active as its heading arrives rather than when it
  // happens to occupy the most pixels.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = groups.find((g) => seen.get(g.id));
        if (first) setActive(first.id);
      },
      { root, rootMargin: "-8% 0px -75% 0px", threshold: 0 },
    );
    for (const g of groups) {
      const el = document.getElementById(g.id);
      if (el) io.observe(el);
    }

    // The last group is usually too short to ever reach the trigger band:
    // there is nothing below it to push it up there, so scrolling to the
    // bottom leaves the previous group marked. Bottom of the scroller means
    // the last group, whatever the observer thinks.
    const onScroll = () => {
      const atEnd =
        root.scrollTop + root.clientHeight >= root.scrollHeight - 24;
      if (atEnd) {
        const last = groups[groups.length - 1];
        if (last) setActive(last.id);
      }
    };
    root.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      io.disconnect();
      root.removeEventListener("scroll", onScroll);
    };
  }, [groups, scrollerRef]);

  const activeIndex = Math.max(
    0,
    groups.findIndex((g) => g.id === active),
  );

  const caption = groups.find((g) => g.id === hovered)?.label ?? "";

  return (
    <nav
      className={cn("relative w-[40px]", className)}
      aria-label="Settings sections"
      onMouseLeave={() => setHovered(null)}
    >
      <ul className="flex flex-col items-start gap-3">
        {groups.map((g, i) => {
          const isActive = g.id === active;
          return (
            <li key={g.id} className="flex">
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
                // The bar is 4px but the button is 16px tall: a 4px hit
                // target is a dare, not a control.
                className="group flex h-4 items-center py-0"
              >
                <span
                  className="block h-[4px] rounded-full transition-all duration-300 ease-out group-hover:!bg-primary motion-reduce:transition-none"
                  style={{
                    width: tickWidth(Math.abs(i - activeIndex)),
                    background: isActive
                      ? "var(--primary)"
                      : `color-mix(in oklab, var(--ink) ${
                          Math.abs(i - activeIndex) === 1 ? 34 : 22
                        }%, transparent)`,
                  }}
                />
              </button>
            </li>
          );
        })}
      </ul>
      {/* Out of flow, so naming a tick never nudges the ticks. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-0 top-full mt-3 block font-mono text-[10px] uppercase tracking-[0.14em] text-faint transition-opacity duration-200 motion-reduce:transition-none",
          caption ? "opacity-100" : "opacity-0",
        )}
        style={{ writingMode: "vertical-lr", textOrientation: "upright" }}
      >
        {caption}
      </span>
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
