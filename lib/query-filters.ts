import { createParser } from "nuqs";

/**
 * A multi-select filter that can be set to NOTHING.
 *
 * The problem this exists for: a filter with a saved default cannot be
 * cleared. Emptying it removes the query param, an absent param means "use
 * the default", and the default comes straight back — so a default of "todo"
 * made "show me every status" unreachable.
 *
 * The fix is to let the URL say "none" out loud, which also lands the exact
 * lifetime you want for free:
 *
 *   - No param at all -> the saved default. Arriving at /tasks fresh, from
 *     the nav, or from a link.
 *   - `?status=none`  -> deliberately empty. Survives a reload and every
 *     router.refresh() a save triggers, because neither touches the URL.
 *   - Leaving and coming back -> a clean /tasks, so the default returns.
 *
 * That is the whole mechanism. There is no timer, no session storage and
 * nothing to expire: "until I navigate away" is what a query string already
 * means, so the clearing lives exactly as long as the URL that holds it.
 */
const EMPTY = "none";

export function parseAsFilterArray<T extends string>(
  parseItem: (value: string) => T | null,
) {
  return createParser<T[]>({
    parse: (value) => {
      if (value === EMPTY) return [];
      const out = value
        .split(",")
        .map((part) => parseItem(part.trim()))
        .filter((v): v is T => v !== null);
      // A param that parses to nothing is a corrupted param, not a choice.
      // Returning null hands it back to the default rather than silently
      // showing an unfiltered list somebody did not ask for.
      return out.length ? out : null;
    },
    serialize: (value) => (value.length ? value.join(",") : EMPTY),
    // Needed for the "same as default, so drop the param" check to work on
    // arrays, which are otherwise compared by identity and never equal.
    eq: (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  });
}

/** `parseAsFilterArray` for a fixed set of allowed values. */
export function parseAsFilterLiteral<T extends string>(values: readonly T[]) {
  return parseAsFilterArray<T>((v) => (values.includes(v as T) ? (v as T) : null));
}

/** `parseAsFilterArray` for free-form ids (tags, projects). */
export const parseAsFilterIds = parseAsFilterArray<string>((v) =>
  v.length ? v : null,
);
