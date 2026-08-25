"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The index down the left of Settings, with a marker that slides to whatever
 * you are looking at.
 *
 * Eleven panels in one scroll with no structure meant the only way to find a
 * setting was to read all of them. Grouping them is most of the fix; this is
 * the part that makes the grouping visible and lets you jump.
 *
 * The marker is one absolutely positioned block that moves, rather than a
 * border on the active item. A single moving object reads as "you are here"
 * travelling down a list; a border that blinks on and off in different places
 * reads as separate things lighting up.
 */
export type SettingsGroup = { id: string; label: string };

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
  const itemsRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const [marker, setMarker] = useState({ top: 0, height: 0 });

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

  // Follow the active item with the marker. Measured rather than computed
  // from an index, because the labels wrap at narrow widths.
  useEffect(() => {
    const el = itemsRef.current[active];
    if (!el) return;
    setMarker({ top: el.offsetTop, height: el.offsetHeight });
  }, [active, groups]);

  return (
    <nav className={cn("relative", className)} aria-label="Settings sections">
      <span
        aria-hidden
        className="absolute left-0 w-[3px] rounded-full bg-primary transition-all duration-300 ease-out motion-reduce:transition-none"
        style={{ top: marker.top, height: marker.height }}
      />
      <ul className="flex flex-col gap-0.5 border-l border-border pl-0">
        {groups.map((g) => (
          <li key={g.id}>
            <button
              type="button"
              ref={(el) => {
                itemsRef.current[g.id] = el;
              }}
              aria-current={active === g.id ? "true" : undefined}
              onClick={() => {
                document
                  .getElementById(g.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={cn(
                "w-full rounded-r-md px-3 py-1.5 text-left text-[13px] transition-colors",
                active === g.id
                  ? "font-semibold text-ink"
                  : "text-muted hover:bg-hover hover:text-ink",
              )}
            >
              {g.label}
            </button>
          </li>
        ))}
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
