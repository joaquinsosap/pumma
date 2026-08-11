/**
 * Where a dragged kanban card lands in the column it is currently over.
 *
 * Split out from the board because the arithmetic is the whole bug. Dropping
 * on a column instead of a card used to mean "put it last", so aiming at the
 * top of a column sent the card to the bottom; and a card dropped on the lower
 * half of its neighbour was inserted above it, one slot short of where it was
 * let go.
 *
 * `overIndex` is the position of the card under the pointer, or -1 when the
 * pointer is over the column's empty space rather than any card. That empty
 * space is only ever BELOW the last card, because the column's drop area
 * starts at the first card, so -1 genuinely does mean last.
 *
 * The half is measured against the POINTER, not against the dragged card's own
 * box. The board re-sorts the list while the drag is in flight, which moves the
 * dragged card's layout position out from under it, so its reported rect lags
 * behind the hand by however far the list has shuffled. The pointer is the one
 * position nothing else can move.
 */
export function dropIndex({
  count,
  overIndex,
  pointerY,
  overTop,
  overHeight,
}: {
  /** Cards already in the target column. */
  count: number;
  /** Index of the card under the pointer, or -1 for the column itself. */
  overIndex: number;
  /** Where the pointer is, in the same space as `overTop`. */
  pointerY: number;
  overTop: number;
  overHeight: number;
}): number {
  if (overIndex < 0) return count;
  // Past the midpoint of the card you are over means you are aiming at the gap
  // under it, not the gap above it.
  const below = pointerY > overTop + overHeight / 2;
  return Math.min(count, overIndex + (below ? 1 : 0));
}
