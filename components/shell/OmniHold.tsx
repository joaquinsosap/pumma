"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { HOLD_BACK_RATE, HOLD_EASE, POP_MS } from "@/lib/omni-hold";

export type HoldFill = {
  /** The colour of what the bar is making now, and of what it will make. */
  from: string;
  to: string;
  /** Shift is down: the colour comes in from the right. */
  backwards: boolean;
  ms: number;
  /** The colour reached the far side with the key still down. */
  onFull: () => void;
};

type Charge = { anim: Animation; el: HTMLElement; letGo: boolean };

const wash = (color: string, pct: number) =>
  `color-mix(in oklch, ${color} ${pct}%, transparent)`;

/** The colour that crosses the capture bar while Tab is held, drawn by hand so it can run back from anywhere and outlive the bar's re-render. */
export function useOmniHold() {
  const layerRef = useRef<HTMLDivElement>(null);
  const chargeRef = useRef<Charge | null>(null);
  const downRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      chargeRef.current?.anim.cancel();
      chargeRef.current = null;
    };
  }, []);

  const begin = useCallback((fill: HoldFill) => {
    const layer = layerRef.current;
    if (!layer) return;
    const running = chargeRef.current;
    if (running) {
      if (!running.letGo) return;
      // A new press while the last colour is still running back: drop that one and start over.
      running.anim.cancel();
      chargeRef.current = null;
    }
    downRef.current = true;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const el = document.createElement("div");
    el.className = "omni-hold-fill";
    el.style.background = `linear-gradient(${
      fill.backwards ? "to left" : "to right"
    }, ${wash(fill.from, 30)}, ${wash(fill.to, 34)})`;
    layer.appendChild(el);

    const shut = fill.backwards ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)";
    const anim = el.animate(
      // Reduced motion: the colour comes up in place and nothing travels.
      still
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ clipPath: shut }, { clipPath: "inset(0 0 0 0)" }],
      { duration: fill.ms, easing: HOLD_EASE, fill: "forwards" },
    );
    const charge: Charge = { anim, el, letGo: false };
    chargeRef.current = charge;

    anim.finished
      .then(() => {
        if (chargeRef.current === charge) chargeRef.current = null;
        if (charge.letGo || !aliveRef.current) {
          el.remove();
          return;
        }
        fill.onFull();
        // Landed: the crossing colour becomes a flash of the new one over the whole bar, gone at once then slowly.
        el.style.background = wash(fill.to, 60);
        el.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: POP_MS,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "forwards",
        }).finished.then(
          () => el.remove(),
          () => el.remove(),
        );
      })
      .catch(() => el.remove());
  }, []);

  /** The key came up. A colour still on its way runs back and nothing switches. */
  const release = useCallback(() => {
    downRef.current = false;
    const charge = chargeRef.current;
    if (!charge || charge.letGo) return;
    charge.letGo = true;
    charge.anim.playbackRate = -HOLD_BACK_RATE;
  }, []);

  const down = useCallback(() => downRef.current, []);

  return useMemo(
    () => ({ layerRef, begin, release, down }),
    [begin, release, down],
  );
}
