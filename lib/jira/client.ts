import "server-only";

import { jiraBaseFromUrl } from "@/lib/jira/address";
import {
  JIRA_TICKET_FIELDS,
  jiraFactsFrom,
  jiraUserIds,
  type JiraTicketFacts,
} from "@/lib/jira/issue";
import type { KnownStatus, Transition } from "@/lib/jira/status-map";
import { whereHostResolves } from "@/lib/outbound-guard";
import { ticketKeyFrom } from "@/lib/ticket-link";

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
  | "no-ticket"
  /** Jira read a write and turned it down: a field it wants, or a value it will not take. */
  | "invalid"
  | "error";

export type JiraAnswer<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      why: JiraFailure;
      error: string;
      /** On a change turned down: the fields Jira asked to be filled in. Empty when it named none. */
      wants?: string[];
    };

const TIMEOUT_MS = 10_000;
/** Finding the address has its own deadline: a name server that never answers must not hold the request open. */
const LOOKUP_MS = 4_000;
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
  "no-ticket":
    "Jira has no ticket with that number, or your token cannot see it.",
  invalid: "Jira turned that change down.",
  error: "Jira answered with an error.",
};

const fail = (why: JiraFailure, detail?: string): JiraAnswer<never> => ({
  ok: false,
  why,
  error: detail ? `${SAID[why]} (${detail})` : SAID[why],
});

/** `work`, or `otherwise` if it has not finished in `ms`. Never rejects. */
function within<T>(ms: number, work: Promise<T>, otherwise: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(otherwise), ms);
    const settle = (value: T) => {
      clearTimeout(timer);
      resolve(value);
    };
    work.then(settle, () => settle(otherwise));
  });
}

type ApiPath = `/rest/api/2/${string}`;

/**
 * One GET against the Jira REST API.
 *
 * `path` is fixed by the caller, never by a user: it always starts at the API
 * root, so a saved address cannot be turned into a request for anything else
 * on that host.
 */
export function jiraGet(
  baseUrl: string,
  token: string,
  path: ApiPath,
  /** What a 404 means for this call. Asking for one ticket, it is that ticket missing, not the Jira. */
  missing: JiraFailure = "not-jira",
): Promise<JiraAnswer<unknown>> {
  return jiraAsk(baseUrl, token, path, missing, null);
}

/**
 * One POST against the Jira REST API: a change made in Jira with the owner's
 * token, so under every rule a read keeps. An answer with no body is a yes.
 */
export function jiraPost(
  baseUrl: string,
  token: string,
  path: ApiPath,
  body: unknown,
  missing: JiraFailure = "not-jira",
): Promise<JiraAnswer<unknown>> {
  return jiraAsk(baseUrl, token, path, missing, { body: JSON.stringify(body) });
}

async function jiraAsk(
  baseUrl: string,
  token: string,
  path: ApiPath,
  missing: JiraFailure,
  write: { body: string } | null,
): Promise<JiraAnswer<unknown>> {
  // Vetted again here, not only when saved: this is the last stop before the token leaves.
  const base = jiraBaseFromUrl(baseUrl);
  if (!base || !token) return fail("address");
  const url = new URL(`${base}${path}`);
  const where = await within(LOOKUP_MS, whereHostResolves(url.hostname), "nowhere");
  // Inside the server's own network is refused; a name that leads nowhere is an address that cannot be reached.
  if (where === "private") return fail("address");
  if (where === "nowhere") return fail("unreachable");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: write ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "PUMMA-jira",
        ...(write
          ? {
              "Content-Type": "application/json",
              // Jira's guard against forged form posts; a script's own request says so.
              "X-Atlassian-Token": "no-check",
            }
          : {}),
      },
      ...(write ? { body: write.body } : {}),
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
    if (res.status === 404) return fail(missing);
    if (write && res.status === 400) {
      // Jira names the fields it wants under `errors`; a move that is no longer offered comes back with none.
      const text = await readCapped(res, 64 * 1024).catch(() => null);
      let wants: string[] = [];
      try {
        const errors = (JSON.parse(text ?? "") as { errors?: unknown })?.errors;
        if (errors && typeof errors === "object" && !Array.isArray(errors)) {
          wants = Object.keys(errors).slice(0, 10);
        }
      } catch {
        // Not JSON: nothing named.
      }
      return { ok: false, why: "invalid", error: SAID.invalid, wants };
    }
    if (!res.ok) return fail("error", String(res.status));
    if (write && res.status === 204) return { ok: true, data: null };

    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) {
      return fail("error", "answer too large");
    }
    const text = await readCapped(res, MAX_BYTES);
    if (text === null) {
      controller.abort();
      return fail("error", "answer too large");
    }
    if (write && !text.trim()) return { ok: true, data: null };
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

/** The body as text, or null once it passes `max` bytes. A body sent in pieces states no length up front, so it is counted as it arrives. */
async function readCapped(res: Response, max: number): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Who the token belongs to. The cheapest call that proves address and token both work. */
export async function jiraMyself(
  baseUrl: string,
  token: string,
): Promise<JiraAnswer<{ name: string; ids: string[] }>> {
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
  return {
    ok: true,
    // `ids` is what a ticket's assignee is matched against, to tell which tickets are the owner's.
    data: { name: name.replace(/\s+/g, " ").slice(0, 80), ids: jiraUserIds(who) },
  };
}

/**
 * One ticket: where it stands, who has it, what kind it is.
 *
 * The number is checked to be a ticket number and nothing else before it goes
 * into the path, so it cannot reach for another part of the API.
 */
export async function jiraIssue(
  baseUrl: string,
  token: string,
  key: string,
): Promise<JiraAnswer<JiraTicketFacts>> {
  const number = ticketKeyFrom(key);
  if (!number) return fail("no-ticket");
  const res = await jiraGet(
    baseUrl,
    token,
    `/rest/api/2/issue/${encodeURIComponent(number)}?fields=${JIRA_TICKET_FIELDS}`,
    "no-ticket",
  );
  if (!res.ok) return res;
  const facts = jiraFactsFrom(res.data);
  return facts ? { ok: true, data: facts } : fail("not-jira");
}

/** Where a ticket stands, and the moves Jira offers from there. */
export type TicketMoves = {
  key: string;
  current: KnownStatus;
  transitions: Transition[];
};

const TRANSITIONS_MAX = 50;
const TRANSITION_ID = /^\d{1,10}$/;

/** One ticket's status and the moves it allows, in one request. */
export async function jiraTicketMoves(
  baseUrl: string,
  token: string,
  key: string,
): Promise<JiraAnswer<TicketMoves>> {
  const number = ticketKeyFrom(key);
  if (!number) return fail("no-ticket");
  const res = await jiraGet(
    baseUrl,
    token,
    `/rest/api/2/issue/${encodeURIComponent(number)}?fields=status&expand=transitions`,
    "no-ticket",
  );
  if (!res.ok) return res;
  const facts = jiraFactsFrom(res.data);
  if (!facts?.status) return fail("not-jira");
  const raw = (res.data as { transitions?: unknown }).transitions;
  const transitions: Transition[] = [];
  for (const t of Array.isArray(raw) ? raw.slice(0, TRANSITIONS_MAX) : []) {
    const id = (t as { id?: unknown } | null)?.id;
    const to = (t as { to?: { name?: unknown } } | null)?.to?.name;
    if (typeof id !== "string" || !TRANSITION_ID.test(id)) continue;
    if (typeof to !== "string" || !to.trim()) continue;
    transitions.push({ id, to: to.replace(/\s+/g, " ").trim().slice(0, 60) });
  }
  return {
    ok: true,
    data: {
      key: facts.key,
      current: { name: facts.status, stage: facts.stage },
      transitions,
    },
  };
}

/** Make one move Jira offered. The id is checked to be one of Jira's move ids before it is sent. */
export async function jiraMoveTicket(
  baseUrl: string,
  token: string,
  key: string,
  transitionId: string,
): Promise<JiraAnswer<null>> {
  const number = ticketKeyFrom(key);
  if (!number) return fail("no-ticket");
  if (!TRANSITION_ID.test(transitionId)) return fail("invalid");
  const res = await jiraPost(
    baseUrl,
    token,
    `/rest/api/2/issue/${encodeURIComponent(number)}/transitions`,
    { transition: { id: transitionId } },
    "no-ticket",
  );
  return res.ok ? { ok: true, data: null } : res;
}
