// A task's link to a ticket in somebody else's tracker, as pure rules.
//
// Only the link is stored. Everything shown from it (the key on the chip, the
// tracker it belongs to) is read back out of the link, so there is one fact
// to keep in step rather than three.

export type TicketLink = {
  /** The link, safe to put in an href. */
  url: string;
  /** "VST-1234" when the link names one; null for a link that is just a link. */
  key: string | null;
  /** What it reads as: a Jira ticket, or some other page. */
  kind: "jira" | "link";
  /** Where it lives, for a chip with no key to show. */
  host: string;
  /** What the chip says. */
  label: string;
};

/** Longest link kept. Browsers and Jira both go further, a pasted ticket never does. */
export const TICKET_URL_MAX = 2048;

/**
 * A pasted link, made safe to store and to open: http or https, no sign-in
 * written into it, trimmed, capped. Null when it is not a usable link, which
 * is also the answer for a blank box.
 *
 * The scheme check is the one that matters. This value ends up in an href, and
 * a `javascript:` link in an href runs.
 */
export function cleanTicketUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > TICKET_URL_MAX) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // "https://me:secret@jira..." would store a password in a task.
  if (url.username || url.password) return null;
  if (!url.hostname) return null;
  // Measured again once tidied: escaping spaces and accents can make a link
  // several times longer than what was pasted, and the cap is on what is kept.
  const clean = url.toString();
  return clean.length > TICKET_URL_MAX ? null : clean;
}

/** Jira issue keys: a project code, a dash, a number. */
const JIRA_KEY = /^[A-Za-z][A-Za-z0-9_]{1,29}-\d{1,9}$/;

/** "VST-1234" typed on its own, in any case. The tidy form, or null when it is not a ticket number. */
export function ticketKeyFrom(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const word = text.trim();
  return JIRA_KEY.test(word) ? word.toUpperCase() : null;
}

/** A path segment as text. A broken escape ("%zz") is no key, and must not throw: this runs while a page draws. */
function decoded(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function jiraKeyIn(url: URL): string | null {
  // ".../browse/VST-1234" on Cloud and Data Center alike, with or without a
  // context path in front; ".../issues/VST-1234" from a filter view.
  const parts = url.pathname.split("/").filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] !== "browse" && parts[i] !== "issues") continue;
    const candidate = decoded(parts[i + 1]);
    if (candidate && JIRA_KEY.test(candidate)) return candidate.toUpperCase();
  }
  // A service desk's customer portal: ".../servicedesk/customer/portal/3/VST-1234".
  const portal = parts.indexOf("portal");
  if (portal > 0 && parts[portal - 1] === "customer" && parts[portal + 2]) {
    const candidate = decoded(parts[portal + 2]);
    if (candidate && JIRA_KEY.test(candidate)) return candidate.toUpperCase();
  }
  // A board with one issue open: "...?selectedIssue=VST-1234".
  const picked = url.searchParams.get("selectedIssue");
  if (picked && JIRA_KEY.test(picked)) return picked.toUpperCase();
  return null;
}

/** What a stored link shows as. Null for no link, or one that should never have been stored. */
export function ticketFromUrl(stored: string | null | undefined): TicketLink | null {
  const clean = cleanTicketUrl(stored);
  if (!clean) return null;
  const url = new URL(clean);
  const host = url.hostname.replace(/^www\./, "");
  const key = jiraKeyIn(url);
  return key
    ? { url: clean, key, kind: "jira", host, label: key }
    : { url: clean, key: null, kind: "link", host, label: host };
}
