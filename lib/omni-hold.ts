/** Hold Tab to switch what the bar is making: the numbers behind the feel. */

/** How long Tab is held before the bar switches. */
export const HOLD_MS = 900;

/** A subtle change of pace: a gentle start, then an even glide that eases into the far edge. */
export const HOLD_EASE = "cubic-bezier(0.35, 0.05, 0.7, 0.8)";

/** Letting go early: the colour runs back this many times faster than it came. */
export const HOLD_BACK_RATE = 3;

/** The flash of the new colour over the whole bar when the switch lands. */
export const POP_MS = 700;

/** Overshoots, then settles: what makes the bar's bump and the chip read as a pop. */
export const POP_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";
