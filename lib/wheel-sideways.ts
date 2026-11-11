/** A wheel only turns up and down and a strip of cards only moves sideways: the rule for lending the strip that turn. */

export type WheelTurn = {
  deltaX: number;
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages: the unit the browser reported the turn in. */
  deltaMode: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
};

export type Strip = {
  /** Where the strip is, or where it is already gliding to. */
  from: number;
  /** The furthest it can go: scrollWidth minus clientWidth. */
  max: number;
  /** Its visible width, which is what a "page" of wheel means. */
  page: number;
};

/** What one line of wheel is worth, for the browsers that count in lines. */
const LINE_PX = 40;

/** A turn this big is a wheel's notch, or a hard flick: it gets a glide. Under it, the strip follows the fingers. */
const NOTCH_PX = 50;

/** Where the strip should be after this turn, or null when the turn is the browser's or the page's to take. */
export function sidewaysTarget(turn: WheelTurn, strip: Strip): number | null {
  if (strip.max <= 0) return null;
  // Ctrl is pinch to zoom, and Shift is the browser's own sideways wheel.
  if (turn.ctrlKey || turn.shiftKey) return null;
  if (Math.abs(turn.deltaY) <= Math.abs(turn.deltaX)) return null;
  const unit =
    turn.deltaMode === 1 ? LINE_PX : turn.deltaMode === 2 ? strip.page : 1;
  const next = Math.max(
    0,
    Math.min(strip.max, strip.from + turn.deltaY * unit),
  );
  // Under a pixel is the end: a zoomed page stops a fraction short of max, and the page must get its wheel back.
  return Math.abs(next - strip.from) < 1 ? null : next;
}

/** Whether a move of this many pixels glides there or lands at once. */
export function glides(px: number): boolean {
  return Math.abs(px) >= NOTCH_PX;
}
