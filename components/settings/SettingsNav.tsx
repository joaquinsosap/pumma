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
 * Closed, it is a 34px strip and each entry reads DOWN it, one upright
 * letter at a time. A rail wide enough for six full names is a column of
 * prose beside a page that is already dense, and the headings inside the page
 * already say what each group is, so the rail only has to be findable.
 * Hovering widens it and the full names lie flat, because the moment you go
 * looking for something is the moment four letters stop being enough.
 *
 * The marker is one absolutely positioned block that moves, rather than a
 * border on the active item. A single travelling object reads as "you are
 * here" moving down a list; a border blinking on in different places reads as
 * separate things lighting up.
 */
export type SettingsGroup = {
  id: string;
  /** Spelled out. Shown for the active entry, and for all of them on hover. */
  label: string;
  /** One word, for entries you are not in. */
  short: string;
};

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
  const [open, setOpen] = useState(false);
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

  // Follow the active item with the marker. Measured rather than derived from
  // an index: entries change height as their labels expand and wrap, and the
  // marker has to track that, which is also what makes the movement read as
  // one object rather than a jump.
  useEffect(() => {
    const el = itemsRef.current[active];
    if (!el) return;
    const measure = () =>
      setMarker({ top: el.offsetTop, height: el.offsetHeight });
    measure();
    // Expanding on hover reflows the list under the marker.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, groups, open]);

  return (
    <nav
      className={cn(
        "relative transition-[width] duration-300 ease-out motion-reduce:transition-none",
        open ? "w-[146px]" : "w-[34px]",
        className,
      )}
      aria-label="Settings sections"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <span
        aria-hidden
        className="absolute left-0 w-[3px] rounded-full bg-primary transition-all duration-300 ease-out motion-reduce:transition-none"
        style={{ top: marker.top, height: marker.height }}
      />
      <ul className="flex flex-col gap-1 border-l border-border">
        {groups.map((g) => {
          const isActive = active === g.id;
          return (
            <li key={g.id}>
              <button
                type="button"
                ref={(el) => {
                  itemsRef.current[g.id] = el;
                }}
                aria-current={isActive ? "true" : undefined}
                aria-label={g.label}
                onClick={() => {
                  document
                    .getElementById(g.id)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className={cn(
                  "w-full rounded-r-md text-[12px] leading-tight transition-all duration-300 ease-out motion-reduce:transition-none",
                  open ? "px-3 py-2 text-left" : "px-0 py-2 text-center",
                  isActive
                    ? "font-semibold text-ink"
                    : "text-muted hover:bg-hover hover:text-ink",
                )}
              >
                {/* Two spellings of the same word, cross-fading in place.
                    Closed, the short one runs down the rail a letter at a
                    time (upright, not rotated, so it reads as letters rather
                    than a sideways word). Open, the full name lies flat.
                    Both are always rendered; only one has height, so the
                    button grows and shrinks instead of jumping. */}
                <span
                  className={cn(
                    "block overflow-hidden transition-all duration-300 ease-out motion-reduce:transition-none",
                    open
                      ? "max-h-0 opacity-0"
                      : "max-h-[220px] opacity-100",
                  )}
                  style={{
                    writingMode: "vertical-rl",
                    textOrientation: "upright",
                    letterSpacing: "0.14em",
                    margin: open ? undefined : "0 auto",
                  }}
                  aria-hidden
                >
                  {g.short}
                </span>
                <span
                  className={cn(
                    "block overflow-hidden whitespace-nowrap transition-all duration-300 ease-out motion-reduce:transition-none",
                    open ? "max-h-[60px] opacity-100" : "max-h-0 opacity-0",
                  )}
                  aria-hidden
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
