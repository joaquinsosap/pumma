"use client";

import { BEATS, type BeatId } from "@/lib/tutorial";

/**
 * Opening the tour on demand, in development only.
 *
 * Reaching a late beat normally means playing the whole tour, and one of the
 * missions cannot be completed at all in a headless preview (the hold meter
 * runs on requestAnimationFrame, which a hidden page does not tick). So
 * checking a change to the sixth beat meant either playing it by hand every
 * time or temporarily editing the component, which is how a probe ends up
 * committed by accident.
 *
 * ## Why this is not a vulnerability
 *
 * The gate is `process.env.NODE_ENV`, which Next inlines at BUILD time. In a
 * production build the comparison is a literal `false` and everything below
 * it is removed by the minifier — there is no runtime flag, no environment
 * variable to set wrongly on the server, and no header or cookie that can
 * turn it back on. It cannot be reached in production because it is not
 * there.
 *
 * Deliberately NOT an env var: an env var is a thing somebody can set on a
 * production box at 2am, and "replay the tutorial" would then be one query
 * string away for every visitor.
 *
 * Even if it did run, the worst it does is show a tutorial. It reads nothing,
 * writes nothing, and grants nothing.
 *
 * Usage: `?tour=1` opens at the start, `?tour=sync` opens on that beat.
 */
export type TourOverride = { index: number } | null;

export function readTourOverride(): TourOverride {
  if (process.env.NODE_ENV === "production") return null;
  if (typeof window === "undefined") return null;

  const raw = new URLSearchParams(window.location.search).get("tour");
  if (!raw) return null;

  // `?tour=1` and `?tour` both mean "from the top".
  if (raw === "1" || raw === "" || raw === "true") return { index: 0 };

  // A number is a beat position; a word is a beat id. Both are useful: the id
  // survives beats being reordered, the number does not, and when you are
  // iterating on beat five you want to type five.
  const asNumber = Number(raw);
  if (Number.isInteger(asNumber) && asNumber >= 0 && asNumber < BEATS.length) {
    return { index: asNumber };
  }

  const byId = BEATS.findIndex((b) => b.id === (raw as BeatId));
  return byId >= 0 ? { index: byId } : { index: 0 };
}
