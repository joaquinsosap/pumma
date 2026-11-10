import "server-only";

import { lookup } from "node:dns/promises";
import { isBlockedHost } from "@/lib/calendar-feed-url";

// Shared by everything that fetches an address a user typed: calendar feeds
// and the Jira connection. Lives apart from both so each can be tested with
// this one seam replaced.

/**
 * The second half of the SSRF defence.
 *
 * A check on the text of a URL rejects what is wrong on its face, but a hostname is not an
 * address: "calendar.example.com" is free to resolve to 127.0.0.1, and that is
 * a deliberate attack, not a hypothetical. So the name is resolved here and
 * the ANSWER is checked before anything connects.
 *
 * This still leaves a rebinding window (the address could change between this
 * lookup and fetch's own). Closing it properly needs a custom agent that pins
 * the socket to the address we checked. Worth doing if this ever accepts
 * feeds from untrusted users; for a personal tool the narrowed window plus
 * the literal checks is a reasonable place to stop, and saying so is better
 * than implying it is airtight.
 */
export async function resolvesToPublicAddress(host: string): Promise<boolean> {
  return (await whereHostResolves(host)) === "public";
}

/**
 * The same lookup, with the two ways of failing told apart: a name that leads
 * inside the server's own network is refused on purpose, a name that leads
 * nowhere is just a wrong or unreachable address. Callers that explain the
 * failure to a person need to say which.
 */
export async function whereHostResolves(
  host: string,
): Promise<"public" | "private" | "nowhere"> {
  try {
    const answers = await lookup(host, { all: true, verbatim: true });
    if (answers.length === 0) return "nowhere";
    return answers.every((a) => !isBlockedHost(a.address)) ? "public" : "private";
  } catch {
    return "nowhere";
  }
}
