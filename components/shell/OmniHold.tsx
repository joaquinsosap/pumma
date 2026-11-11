"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  FLASH_OUT_RATE,
  HOLD_EASE,
  LET_GO_MS,
  POP_MS,
} from "@/lib/omni-hold";

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

/** The colour that crosses the capture bar while Tab is held, drawn by hand so it can stop anywhere and outlive the bar's re-render. */
export function useOmniHold() {
  const layerRef = useRef<HTMLDivElement>(null);
  const chargeRef = useRef<Charge | null>(null);
  const flashRef = useRef<Animation | null>(null);
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
    if (!layer || chargeRef.current) return;
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
        if (!aliveRef.current) {
          el.remove();
          return;
        }
        // Let go on the very frame it arrived: the fade that release started takes it away.
        if (charge.letGo) return;
        fill.onFull();
        // Landed: the crossing colour becomes a flash of the new one over the whole bar, which fades out evenly.
        el.style.background = wash(fill.to, 52);
        const flash = el.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: POP_MS,
          easing: "cubic-bezier(0.33, 1, 0.68, 1)",
          fill: "forwards",
        });
        flashRef.current = flash;
        const gone = () => {
          if (flashRef.current === flash) flashRef.current = null;
          el.remove();
        };
        flash.finished.then(gone, gone);
      })
      .catch(() => el.remove());
  }, []);

  /** The key came up: whatever colour is on the bar goes away at once, and a switch still on its way is called off. */
  const release = useCallback(() => {
    downRef.current = false;
    const charge = chargeRef.current;
    if (charge && !charge.letGo) {
      charge.letGo = true;
      chargeRef.current = null;
      // It stops where it is and fades there: running back across the bar took longer the further it had got.
      charge.anim.pause();
      const el = charge.el;
      el.animate({ opacity: 0 }, {
        duration: LET_GO_MS,
        easing: "ease-out",
        fill: "forwards",
      }).finished.then(
        () => el.remove(),
        () => el.remove(),
      );
    }
    // The flash of a switch that already landed leaves with the key too.
    const flash = flashRef.current;
    if (flash?.playState === "running") flash.updatePlaybackRate(FLASH_OUT_RATE);
  }, []);

  const down = useCallback(() => downRef.current, []);

  return useMemo(
    () => ({ layerRef, begin, release, down }),
    [begin, release, down],
  );
}
