"use client";

import { useEffect, useState } from "react";

/**
 * The part of the window you can actually see, as a box to lay out inside.
 *
 * This exists because deriving a keyboard HEIGHT and subtracting it is the
 * wrong shape of answer on iOS. `useKeyboardInset` computes
 * `innerHeight - (vv.height + vv.offsetTop)`, and on iOS Safari that
 * difference also contains Safari's own bottom bar and the form accessory
 * strip. Anything that then reserves that many pixels reserves about a
 * hundred too many, which is a full-screen overlay leaving a band of empty
 * page under itself and squeezing its contents to fit a window that was never
 * that small.
 *
 * So this reports the visible box instead of guessing at what is covering the
 * rest. Whatever the browser is doing with its own chrome, the answer is
 * self-correcting: an element placed at `top` with this `height` covers
 * exactly what the user can see, and nothing has to know why.
 *
 * `position: fixed` is relative to the LAYOUT viewport, which is why `top`
 * has to be `offsetTop`: iOS scrolls the visual viewport inside the layout
 * one to keep a focused field visible, and without it the box drifts by
 * however far the page was pushed.
 *
 * Returns null until measured, and on anything without visualViewport, so
 * callers keep their normal layout rather than laying out against a guess.
 */
export type ViewportBox = {
  top: number;
  height: number;
  /** Window height not visible: keyboard and any chrome attached to it. */
  inset: number;
  keyboardOpen: boolean;
};

export function useVisualViewport(): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const read = () => {
      const covered = window.innerHeight - vv.height;
      setBox({
        top: Math.round(vv.offsetTop),
        height: Math.round(vv.height),
        // How much of the WINDOW is hidden below the visible box — the
        // keyboard plus whatever chrome rides on it. Used as padding under
        // content rather than as a height for anything: see the note in
        // TutorialOverlay about why a backdrop must never be sized from this.
        inset: Math.max(0, Math.round(covered - vv.offsetTop)),
        // Only for deciding whether to bother, never for arithmetic. A few
        // pixels of browser chrome are normal; a keyboard is never this short.
        keyboardOpen: covered > 120,
      });
    };

    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, []);

  return box;
}
