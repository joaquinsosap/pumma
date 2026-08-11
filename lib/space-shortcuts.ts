/**
 * The number keys, and which space each one goes to.
 *
 * Same order as the sidebar, because the shortcut you reach for is the one
 * that matches what you are looking at: 1 is the top item, 9 is the bottom
 * one. Anything that reorders the sidebar has to reorder this, which is what
 * the test beside it checks.
 */
export const SPACE_SHORTCUTS: { key: string; href: string; label: string }[] = [
  { key: "1", href: "/", label: "Home" },
  { key: "2", href: "/tasks", label: "Tasks" },
  { key: "3", href: "/notes", label: "Notes" },
  { key: "4", href: "/habits", label: "Habits" },
  { key: "5", href: "/goals", label: "Goals" },
  { key: "6", href: "/projects", label: "Projects" },
  { key: "7", href: "/calendar", label: "Calendar" },
  { key: "8", href: "/life", label: "Life calendar" },
  { key: "9", href: "/assistant", label: "Assistant" },
];

/**
 * Where a keystroke should take you, or null if it should be left alone.
 *
 * Modifiers are a deliberate no: ⌘1 and ⌥1 belong to the browser's own tab
 * switching and window management, and quietly stealing them is how a web app
 * makes itself annoying to use. A bare digit is ours; a digit with anything
 * held down is not.
 *
 * Digits from the number row and the numpad both count, since one is not more
 * of a "1" than the other.
 */
export function spaceForKey(
  key: string,
  modifiers: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean },
): string | null {
  if (modifiers.meta || modifiers.ctrl || modifiers.alt || modifiers.shift) {
    return null;
  }
  return SPACE_SHORTCUTS.find((s) => s.key === key)?.href ?? null;
}
