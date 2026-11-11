// One way for any button on a page to say "I want to write a new one of these".
//
// Capturing happens in one place: the bar across the top on a wide screen, a
// sheet from the dock on a phone. A button elsewhere does not open a second
// form; it hands over to that place, already set to the right kind of thing.

import type { OmniType } from "@/lib/types";

/** Heard by the phone's capture sheet, which opens on it. The dock fires the same one. */
export const CAPTURE_SHEET_EVENT = "pumma:capture";
/** Heard by the bar on a wide screen: it switches to the type and takes the caret. */
export const CAPTURE_BAR_EVENT = "pumma:capture-bar";

/**
 * The bar is drawn from this width up (Tailwind's `lg`). Below it the sheet is
 * the way in. In rem, as Tailwind writes it: with a larger browser font the
 * breakpoint moves, and a pixel count here would send the request to a bar
 * that is not on screen.
 */
const BAR_FROM = "(min-width: 64rem)";

/** Whether the bar is on this screen. */
export function barOnScreen(): boolean {
  return window.matchMedia(BAR_FROM).matches;
}

/**
 * Hand over to wherever capturing happens on this screen, set to `type`.
 * `project` asks for a project instead of a task: what is typed becomes its
 * name, in the bar and in the phone's sheet alike. Neither offers a project
 * by itself, so this is the only way into one.
 */
export function askCapture(
  type: OmniType,
  { project = false }: { project?: boolean } = {},
): void {
  window.dispatchEvent(
    new CustomEvent(barOnScreen() ? CAPTURE_BAR_EVENT : CAPTURE_SHEET_EVENT, {
      detail: { type: project ? "task" : type, project },
    }),
  );
}
