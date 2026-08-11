"use client";

import { useEffect, useState } from "react";

/**
 * How many pixels of the window the on-screen keyboard is currently covering.
 *
 * There is no way to put a button in the keyboard's own accessory bar from a
 * web page: on iOS that strip belongs to Safari, and nothing we render can
 * appear inside it. What we can do is the thing every app that looks like it
 * has one actually does — draw our own bar and keep it sitting exactly on top
 * of the keyboard.
 *
 * `visualViewport` is what makes that possible. It describes the part of the
 * page you can actually see, which is the window minus whatever the keyboard
 * has taken, so the difference between the two IS the keyboard's height. It
 * updates while the keyboard animates and it works on both iOS Safari and
 * Android Chrome, which the alternatives do not: the VirtualKeyboard API is
 * Chromium-only, and a plain `resize` listener never fires on iOS because iOS
 * does not resize the layout viewport for the keyboard at all.
 *
 * `offsetTop` is in there because iOS scrolls the visual viewport up to keep
 * the focused field visible, and without it the bar drifts by however far the
 * page was pushed.
 *
 * Returns 0 when no keyboard is up, so callers can treat it as "is there a
 * keyboard, and how tall". A hardware keyboard reports nothing, which is
 * correct: there is no on-screen keyboard to sit above.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const read = () => {
      const covered = window.innerHeight - (vv.height + vv.offsetTop);
      // Small negative values and a pixel or two of rounding are normal even
      // with no keyboard; a real one is never this short.
      setInset(covered > 60 ? Math.round(covered) : 0);
    };

    read();
    vv.addEventListener("resize", read);
    vv.addEventListener("scroll", read);
    return () => {
      vv.removeEventListener("resize", read);
      vv.removeEventListener("scroll", read);
    };
  }, []);

  return inset;
}
