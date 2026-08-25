// Multi-select over a list of tasks: ctrl/cmd-click picks individuals,
// shift-click takes everything between the anchor and the click. The rules are
// pure and live here so both the tasks list and the kanban board behave the
// same way, and so the fiddly parts (a range with no anchor, an anchor that
// has since been filtered out of view) are testable without a DOM.

/** What a click means, given which modifiers were held. */
export type SelectIntent =
  /** No modifier — not a selection gesture at all; the caller opens the task. */
  | "open"
  /** ctrl/cmd — add or remove this one. */
  | "toggle"
  /** shift — everything from the anchor to here, replacing the selection. */
  | "range"
  /** ctrl/cmd + shift — the same range, added to what's already selected. */
  | "rangeAdd";

export type SelectionState = {
  /** Selected ids, always in the list's own order. */
  ids: string[];
  /** Where a shift-range measures from. */
  anchor: string | null;
};

export const EMPTY_SELECTION: SelectionState = { ids: [], anchor: null };

/** Read the modifiers off a click. metaKey is cmd on a Mac, ctrlKey elsewhere. */
export function intentFor(e: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}): SelectIntent {
  const multi = Boolean(e.metaKey || e.ctrlKey);
  if (e.shiftKey) return multi ? "rangeAdd" : "range";
  return multi ? "toggle" : "open";
}

/** True when the id is non-empty and still rendered in the list. */
function liveIn(order: string[], id: string | null | undefined): boolean {
  return Boolean(id) && order.includes(id as string);
}

/** Ids between two positions in `order`, inclusive, whichever way round. */
function span(order: string[], a: number, b: number): string[] {
  if (a < 0 || b < 0) return [];
  return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** Keep a selection in the list's order, so the panel and the rows agree. */
function ordered(order: string[], ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  return order.filter((id) => wanted.has(id));
}

/**
 * The next selection after clicking `id`.
 *
 * `order` is the ids as currently rendered, top to bottom — filtering, sorting
 * and grouping have already been applied, so a shift-range covers what the
 * user can actually see rather than some underlying order they can't.
 */
export function reduceSelection(
  state: SelectionState,
  order: string[],
  id: string,
  intent: SelectIntent,
  /**
   * A row to measure from when the state has no anchor of its own.
   *
   * The open task is the case this exists for. Its id lives in the URL, so
   * after a refresh the row is highlighted and looks every bit selected, while
   * the anchor, which is React state, is gone. A shift-click then took the
   * "no anchor" path and selected only the row it landed on, which reads as
   * the range silently failing. The row you can see is the row you expect to
   * measure from.
   */
  anchorFallback?: string | null,
): SelectionState {
  // A plain click drops the selection, but it still says where you are: the
  // shift-click that follows has to range from the row you just clicked, not
  // from nothing. Without this the first shift-click after opening a task
  // selects only itself and you have to shift-click twice to get a range.
  if (intent === "open") return { ids: [], anchor: id };

  if (intent === "toggle") {
    // Same reasoning as the range below: with nothing selected yet, the open
    // task's row is highlighted and reads as selected, so ctrl-clicking a
    // second row should leave you holding both. Starting from an empty set
    // dropped the row the user could see and kept only the new one.
    const base =
      state.ids.length === 0 && liveIn(order, anchorFallback)
        ? [anchorFallback as string]
        : state.ids;
    const has = base.includes(id);
    const next = has
      ? base.filter((x) => x !== id)
      : ordered(order, [...base, id]);
    // Deselecting the anchor leaves the next range measuring from this click,
    // which is where the user's attention is anyway.
    return { ids: next, anchor: id };
  }

  // A range needs somewhere to measure from. Without a live anchor — first
  // click of the session, or the anchor scrolled out of the current filter —
  // this click becomes the anchor and selects only itself.
  const anchor =
    (liveIn(order, state.anchor) ? state.anchor : null) ??
    (liveIn(order, anchorFallback) ? (anchorFallback as string) : null);
  if (!anchor) return { ids: [id], anchor: id };

  const anchorAt = order.indexOf(anchor);
  const clickAt = order.indexOf(id);
  if (clickAt < 0) return { ids: [id], anchor: id };

  // Shift-clicking past the anchor onto the OTHER side of the current range
  // grows the range rather than throwing away the half you already had. Having
  // selected n-5…n, shift-clicking n+5 should give you n-5…n+5 — measuring
  // from the anchor would silently drop the five rows below it.
  //
  // The far end only takes over when the click crosses the anchor, so a click
  // on the same side still shrinks the range the way you'd expect.
  let from = anchorAt;
  const spots = state.ids.map((x) => order.indexOf(x)).filter((i) => i >= 0);
  if (spots.length) {
    const lo = Math.min(...spots);
    const hi = Math.max(...spots);
    if (clickAt > anchorAt && lo < anchorAt) from = lo;
    else if (clickAt < anchorAt && hi > anchorAt) from = hi;
  }

  const range = span(order, from, clickAt);
  if (!range.length) return { ids: [id], anchor: id };

  const ids =
    intent === "rangeAdd" ? ordered(order, [...state.ids, ...range]) : range;
  // The anchor stays put so you can keep extending or shrinking the same
  // range with repeated shift-clicks.
  return { ids, anchor };
}

/**
 * Drop ids that are no longer in the list. Rows disappear when a filter
 * changes or another device deletes something, and a selection that outlives
 * its rows shows a count for tasks nobody can see.
 */
export function pruneSelection(
  state: SelectionState,
  order: string[],
): SelectionState {
  const live = new Set(order);
  if (state.ids.every((id) => live.has(id))) return state;
  return {
    ids: state.ids.filter((id) => live.has(id)),
    anchor: state.anchor && live.has(state.anchor) ? state.anchor : null,
  };
}
