/**
 * Rebuilding a query string from Next's parsed searchParams without losing
 * anything.
 *
 * This exists as its own function, with its own test, because of how the bug
 * it fixes presents. Better Auth signs the authorization parameters and names
 * the covered ones in a REPEATED key:
 *
 *   ba_param=ba_iat&ba_param=client_id&ba_param=code_challenge&...
 *
 * Next parses repeated keys into an array. The obvious reconstruction filters
 * to `typeof v === "string"` to satisfy the type, which quietly drops every
 * repeat. What comes out still has a `sig`, still looks like a complete
 * authorization request, and is refused with `invalid_signature` the instant
 * the user presses Allow. The message says nothing about missing parameters,
 * and the page that built it looks perfectly reasonable.
 *
 * It also fails one hundred percent of the time, so it is not the kind of bug
 * that reaches production and then hides.
 */

/** What Next hands a page as `searchParams`. */
export type ParsedQuery = Record<string, string | string[] | undefined>;

/** Reassemble the query, preserving repeated keys and their order. */
export function rebuildQuery(params: ParsedQuery): string {
  return new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) => {
      if (Array.isArray(value)) {
        return value.map((v) => [key, v] as [string, string]);
      }
      return typeof value === "string" ? [[key, value] as [string, string]] : [];
    }),
  ).toString();
}
