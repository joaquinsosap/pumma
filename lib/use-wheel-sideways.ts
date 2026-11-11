"use client";

import { useEffect, type RefObject } from "react";
import { glides, sidewaysTarget } from "@/lib/wheel-sideways";

/** Lets a plain up and down wheel move a sideways strip (rule in lib/wheel-sideways); a sideways swipe stays the browser's. */
export function useWheelSideways(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Where a glide is heading: notches turned faster than the glide runs add up from here.
    let heading: number | null = null;
    let forget = 0;
    const arrived = () => {
      heading = null;
    };

    const onWheel = (e: WheelEvent) => {
      const from = heading ?? el.scrollLeft;
      const next = sidewaysTarget(e, {
        from,
        max: el.scrollWidth - el.clientWidth,
        page: el.clientWidth,
      });
      if (next === null) return;
      e.preventDefault();

      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Once gliding, the small turns that trail a flick join the glide: landing them at once would jump it to its end.
      if (!still && (heading !== null || glides(next - from))) {
        heading = next;
        el.scrollTo({ left: next, behavior: "smooth" });
        // For the browsers with no scrollend: the glide is over well inside this.
        window.clearTimeout(forget);
        forget = window.setTimeout(arrived, 700);
      } else {
        el.scrollLeft = next;
      }
    };

    // Not passive: the turn is taken from the page only when the strip uses it.
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("scrollend", arrived);
    // A press on the strip (its scrollbar, a card) moves it another way: the old heading no longer counts.
    el.addEventListener("pointerdown", arrived);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scrollend", arrived);
      el.removeEventListener("pointerdown", arrived);
      window.clearTimeout(forget);
    };
  }, [ref]);
}
