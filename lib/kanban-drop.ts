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
 * pointer is over the column itself rather than any card.
 *
 * -1 does NOT mean "last". It used to be treated that way, on the reasoning
 * that the column's drop area starts at the first card so its bare space must
 * be below them all. That is wrong: the cards are laid out with a gap between
 * them, and those gaps belong to the column, not to either neighbour. Every
 * gap in the list is a strip a few pixels tall where the pointer is over the
 * column and no card, and releasing there sent the card to the bottom of the
 * list. It reads as random, because the strips are thin and you only land in
 * one when moving quickly, and the whole column lighting up at that moment is
 * the same fact showing itself.
 *
 * So when the pointer is over the column, the position is worked out from the
 * cards themselves: `slots` holds the vertical midpoint of every card
 * currently drawn in that column, and the card goes after each one the pointer
 * has passed. Below the last card that still yields "last", which is how the
 * old assumption looked right whenever it was tested at the bottom.
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
  slots,
}: {
  /** Cards already in the target column. */
  count: number;
  /** Index of the card under the pointer, or -1 for the column itself. */
  overIndex: number;
  /** Where the pointer is, in the same space as `overTop`. */
  pointerY: number;
  overTop: number;
  overHeight: number;
  /**
   * Vertical midpoints of the cards currently drawn in the target column,
   * excluding the one being dragged. Only consulted when the pointer is over
   * the column rather than a card. Order does not matter: the answer is a
   * count, not a lookup. Omitted or empty means an empty column, where last
   * and first are the same thing.
   */
  slots?: readonly number[];
}): number {
  if (overIndex < 0) {
    if (!slots || slots.length === 0) return count;
    // Every card whose middle the pointer is already past is a card this one
    // goes after.
    let passed = 0;
    for (const mid of slots) if (mid < pointerY) passed++;
    return Math.min(count, passed);
  }
  // Past the midpoint of the card you are over means you are aiming at the gap
  // under it, not the gap above it.
  const below = pointerY > overTop + overHeight / 2;
  return Math.min(count, overIndex + (below ? 1 : 0));
}
