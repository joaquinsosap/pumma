/**
 * Which tags fit on the one line under a task title.
 *
 * The line must never become two lines. A task with six tags would otherwise
 * make its row twice as tall as its neighbours, and a list of seventy tasks
 * where some rows are double-height reads as broken rather than as informative.
 *
 * So tags are dropped rather than wrapped, and the count of what was dropped is
 * shown instead. Dropping is better than clipping here: half a tag name cut off
 * mid-word looks like a rendering bug, while "+2" is a fact the reader can act
 * on by opening the task.
 *
 * Measured in characters rather than pixels because the line is monospaced —
 * every glyph is the same width, so a character budget is exact without
 * touching the DOM. Measuring pixels would mean a ResizeObserver per row, which
 * on a seventy-row list is a lot of layout work to learn something arithmetic
 * already knows. CSS still carries `overflow-hidden` and `flex-nowrap` as the
 * hard guarantee; this function decides what looks deliberate inside it.
 */
export type TagLike = { id: string; name: string; color?: string };

export type TagLineFit<T extends TagLike> = {
  /** Tags to render, in the order given. */
  shown: T[];
  /** How many were left out. Zero means everything fitted. */
  hidden: number;
};

/** "#" plus the name. */
const tagCost = (name: string) => name.length + 1;

/** The gap between two tags, in character widths. */
const GAP = 2;

/** Width of the "+N" counter, including its own leading gap. */
const counterCost = (n: number) => GAP + 1 + String(n).length;

/**
 * Fit as many tags as the budget allows, in order.
 *
 * Order is preserved rather than optimised: packing short tags first to fit
 * more of them would reorder the line every time a tag was renamed, and a list
 * whose tags reshuffle on edit is worse than one that shows fewer.
 */
export function fitTagLine<T extends TagLike>(
  tags: T[],
  budgetChars: number,
): TagLineFit<T> {
  if (tags.length === 0) return { shown: [], hidden: 0 };

  const shown: T[] = [];
  let used = 0;

  for (let i = 0; i < tags.length; i++) {
    const cost = (shown.length === 0 ? 0 : GAP) + tagCost(tags[i].name);
    const remaining = tags.length - i - 1;
    // Room has to be left for the counter, but only if anything will be left
    // over once this tag is placed. The last tag competes with nothing.
    const reserve = remaining > 0 ? counterCost(remaining) : 0;

    if (used + cost + reserve > budgetChars) break;
    shown.push(tags[i]);
    used += cost;
  }

  // A single tag too long for the line still renders: one truncated tag says
  // more than a bare "+1", and CSS trims the overflow. Showing nothing at all
  // would make the tag look deleted.
  if (shown.length === 0) return { shown: [tags[0]], hidden: tags.length - 1 };

  return { shown, hidden: tags.length - shown.length };
}

/**
 * Width of one character in the tag line, in pixels.
 *
 * The line is 11px monospace, where every glyph is the same width. Measured
 * from the rendered font rather than guessed: IBM Plex Mono is 0.6em, so
 * 11 * 0.6 = 6.6. One character is shaved off the resulting budget as slack,
 * because a line that fits exactly still looks like it is touching the edge.
 */
const CHAR_PX = 6.6;

/** How many characters fit in a container of this pixel width. */
export function budgetForWidth(px: number): number {
  return Math.max(0, Math.floor(px / CHAR_PX) - 1);
}
