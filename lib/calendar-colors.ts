// Telling one calendar from another at a glance.
//
// The colours were doing no work. A meeting you made in PUMMA on the work
// side was oklch(0.58 0.14 245), and a subscribed work calendar defaulted to
// --projects, which is the same blue — so the only thing distinguishing your
// own meetings from somebody else's was a small chain icon at the end of the
// row. An icon is something you read; a colour is something you already know
// by the second day.
//
// So: everything PUMMA owns wears ONE colour, and every subscription gets its
// own from a palette, assigned so that two feeds never start out looking the
// same, and changeable because the right answer depends on which calendars a
// given person actually has.

/**
 * Meetings you made here. One colour for both sides of life, deliberately:
 * the question this colour answers is "is this mine or mirrored", and
 * personal vs work is already carried by the life filter.
 */
export const OWN_MEETING_COLOR = "oklch(0.55 0.16 274)";

/**
 * Colours a subscribed calendar can wear.
 *
 * Same lightness and chroma, different hue, so no feed shouts louder than
 * another and the set stays legible on both grounds. Deliberately clear of
 * OWN_MEETING_COLOR's hue (274), so "mine" never reads as "a feed".
 */
export const FEED_PALETTE: { name: string; value: string }[] = [
  { name: "Teal", value: "oklch(0.62 0.13 200)" },
  { name: "Green", value: "oklch(0.62 0.14 155)" },
  { name: "Amber", value: "oklch(0.68 0.14 75)" },
  { name: "Red", value: "oklch(0.62 0.17 25)" },
  { name: "Pink", value: "oklch(0.62 0.17 350)" },
  { name: "Blue", value: "oklch(0.62 0.14 245)" },
  { name: "Lime", value: "oklch(0.66 0.14 130)" },
  { name: "Slate", value: "oklch(0.55 0.05 250)" },
];

/**
 * The next colour that is not already in use.
 *
 * Falls back to cycling once every colour is taken: eight calendars in and a
 * repeat is better than refusing to add a ninth.
 */
export function nextFeedColor(taken: string[]): string {
  const used = new Set(taken);
  const free = FEED_PALETTE.find((c) => !used.has(c.value));
  return (free ?? FEED_PALETTE[taken.length % FEED_PALETTE.length]).value;
}
