/** Hold Tab to switch what the bar is making: the numbers behind the feel. */

/** How long Tab is held before the bar switches. */
export const HOLD_MS = 900;

/** Very slow, then a rush: most of the hold shows a sliver, so the arrival lands as one beat. */
export const HOLD_EASE = "cubic-bezier(0.7, 0, 0.84, 0)";

/** Letting go early: the colour runs back this many times faster than it came. */
export const HOLD_BACK_RATE = 3;

/** The flash of the new colour over the whole bar when the switch lands. */
export const POP_MS = 460;

/** Overshoots, then settles: what makes the bar's bump and the chip read as a pop. */
export const POP_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";
