import "server-only";

import { jiraBaseFromUrl } from "@/lib/jira/address";
import { whereHostResolves } from "@/lib/outbound-guard";

// Talking to a Jira its owner connected. Every request carries their token, so
// the rules are about where that token may go: only to the address they saved,
// only over https, only to a public host, and never along a redirect.

/** Why a request to Jira did not give an answer, in words the owner can act on. */
export type JiraFailure =
  | "address"
  | "unreachable"
  | "sign-in"
  | "refused"
  | "forbidden"
  | "not-jira"
  | "error";

export type JiraAnswer<T> =
  | { ok: true; data: T }
  | { ok: false; why: JiraFailure; error: string };

const TIMEOUT_MS = 10_000;
/** A page of issues is tens of kilobytes. This is room for that, and a ceiling on anything else. */
const MAX_BYTES = 2 * 1024 * 1024;

const SAID: Record<JiraFailure, string> = {
  address: "That is not an address PUMMA can connect to. Use your Jira's https address.",
  unreachable:
    "PUMMA's server could not reach that address. Check it is right, and that it is open from outside your company's network.",
  "sign-in":
    "Jira sent PUMMA to a sign-in page instead of answering. The token was not accepted, or this address sits behind single sign-on.",
  refused: "Jira did not accept that token.",
  forbidden:
    "Jira refused the request. The token may lack access, or Jira wants a CAPTCHA after failed sign-ins.",
  "not-jira": "That address answered, but not like a Jira.",
  error: "Jira answered with an error.",
};

const fail = (why: JiraFailure, detail?: string): JiraAnswer<never> => ({
  ok: false,
  why,
  error: detail ? `${SAID[why]} (${detail})` : SAID[why],
});

/**
 * One GET against the Jira REST API.
 *
 * `path` is fixed by the caller, never by a user: it always starts at the API
 * root, so a saved address cannot be turned into a request for anything else
 * on that host.
 */
export async function jiraGet(
  baseUrl: string,
  token: string,
  path: `/rest/api/2/${string}`,
): Promise<JiraAnswer<unknown>> {
  // Vetted again here, not only when saved: this is the last stop before the token leaves.
  const base = jiraBaseFromUrl(baseUrl);
  if (!base || !token) return fail("address");
  const url = new URL(`${base}${path}`);
  const where = await whereHostResolves(url.hostname);
  // Inside the server's own network is refused; a name that leads nowhere is an address that cannot be reached.
  if (where === "private") return fail("address");
  if (where === "nowhere") return fail("unreachable");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "PUMMA-jira",
      },
      signal: controller.signal,
      // A redirect would carry the token to wherever it points. Jira's own
      // answer to a bad token is a redirect to its sign-in page, so this is
      // also how a refused token is told apart from a working one.
      redirect: "manual",
      cache: "no-store",
    });

    if (res.status >= 300 && res.status < 400) return fail("sign-in");
    if (res.status === 401) return fail("refused");
    if (res.status === 403) return fail("forbidden");
    if (res.status === 404) return fail("not-jira");
    if (!res.ok) return fail("error", String(res.status));

    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
      return fail("error", "answer too large");
    }
    const text = await res.text();
    if (text.length > MAX_BYTES) return fail("error", "answer too large");
    try {
      return { ok: true, data: JSON.parse(text) as unknown };
    } catch {
      return fail("not-jira");
    }
  } catch {
    return fail("unreachable");
  } finally {
    clearTimeout(timer);
  }
}

/** Who the token belongs to. The cheapest call that proves address and token both work. */
export async function jiraMyself(
  baseUrl: string,
  token: string,
): Promise<JiraAnswer<{ name: string }>> {
  const res = await jiraGet(baseUrl, token, "/rest/api/2/myself");
  if (!res.ok) return res;
  const who = res.data as { displayName?: unknown; name?: unknown } | null;
  const name =
    typeof who?.displayName === "string" && who.displayName.trim()
      ? who.displayName.trim()
      : typeof who?.name === "string" && who.name.trim()
        ? who.name.trim()
        : null;
  // Signed-out Jiras answer some calls with a body for "anonymous": no name means nobody is signed in.
  if (!name) return fail("not-jira");
  // Somebody else's text, shown on a settings screen: one line, bounded.
  return { ok: true, data: { name: name.replace(/\s+/g, " ").slice(0, 80) } };
}
