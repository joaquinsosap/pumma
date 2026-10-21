"use client";

import { useLayoutEffect, useRef } from "react";
import {
  OBFUSCATE_POOL,
  bucketByWidth,
  obfuscate,
  type WidthBuckets,
} from "@/lib/obfuscate";

/** Widths per loaded font, shared by every scramble on the page. */
const bucketCache = new Map<string, WidthBuckets>();

function measure(font: string): WidthBuckets | null {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  ctx.font = font;
  return bucketByWidth(OBFUSCATE_POOL, (ch) => ctx.measureText(ch).width);
}

/** `text` drawn like Minecraft's §k: same-width random characters every frame, written outside React. */
export function ScrambleText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    let frame = 0;

    const cs = getComputedStyle(el);
    const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    let buckets = bucketCache.get(font) ?? measure(font);
    if (!bucketCache.has(font) && buckets) {
      // Fallback-face widths go stale when the pixel font lands, so only a loaded font is cached.
      if (document.fonts?.check(font)) bucketCache.set(font, buckets);
      else
        document.fonts
          ?.load(font)
          .then(() => {
            if (!alive) return;
            buckets = measure(font);
            if (buckets) bucketCache.set(font, buckets);
          })
          // Offline or blocked: keep scrambling with the fallback face's widths.
          .catch(() => {});
    }

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = () => {
      el.textContent = obfuscate(text, buckets);
      if (!still) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, [text]);

  return <span ref={ref} aria-hidden className={className} />;
}
