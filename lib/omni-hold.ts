/** Hold Tab to switch what the bar is making: the numbers behind the feel. */

/** How long Tab is held before the bar switches. */
export const HOLD_MS = 480;

/** Each further switch while the key stays down. */
export const HOLD_AGAIN_MS = 400;

/** Slow, then fast: the first third barely moves, so a brushed key shows almost nothing. */
export const HOLD_EASE = "cubic-bezier(0.5, 0, 0.75, 0)";

/** Letting go early: the colour runs back this many times faster than it came. */
export const HOLD_BACK_RATE = 3;

/** The wave that crosses the bar once the switch lands. */
export const WAVE_MS = 720;
