// Where a Jira lives, worked out from whatever link its owner pasted.
//
// People copy the address bar, not the "base URL": a dashboard, a ticket, a
// board. Every Jira page sits under the same root, so the root is what comes
// before the first path word only Jira pages use.

import { isBlockedHost } from "@/lib/calendar-feed-url";

/** Path words that start a Jira page. Whatever precedes one is the Jira's own root. */
const PAGE_WORDS = new Set([
  "secure",
  "browse",
  "issues",
  "projects",
  "plugins",
  "rest",
  "servicedesk",
  "login.jsp",
  "dashboard.jspa",
  "jira.webresources",
]);

const BASE_MAX = 300;

/**
 * The root of a Jira from a pasted link, or null when it cannot be one.
 *
 * https only: the token travels in every request to this address, and http
 * would send it in the clear. No sign-in written into the link, and no host
 * that only means something inside the server's own network.
 */
export function jiraBaseFromUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let text = raw.trim();
  if (!text || text.length > 2048) return null;
  // "service-desk.example.com" typed with no scheme is still an address.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (isBlockedHost(url.hostname)) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  const cut = parts.findIndex((p) => PAGE_WORDS.has(p.toLowerCase()));
  const root = (cut === -1 ? parts : parts.slice(0, cut)).join("/");
  const base = root ? `${url.origin}/${root}` : url.origin;
  return base.length > BASE_MAX ? null : base;
}

/** A ticket's page on that Jira. */
export function jiraIssueUrl(base: string, key: string): string {
  return `${base.replace(/\/+$/, "")}/browse/${encodeURIComponent(key)}`;
}
