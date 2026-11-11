import "server-only";

import { cache } from "react";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import {
  getJiraSecretsEnc,
  getJiraStatusMapEnc,
  updateSettings,
} from "@/lib/db/settings";
import { jiraBaseFromUrl, jiraIssueUrl, jiraKeyOn } from "@/lib/jira/address";
import { jiraIssue } from "@/lib/jira/client";
import type { TicketRead } from "@/lib/jira/issue";
import {
  emptyStatusMap,
  readStatusMap,
  withKnown,
  type JiraStatusMap,
  type KnownStatus,
} from "@/lib/jira/status-map";
import { cleanTicketUrl, ticketKeyFrom } from "@/lib/ticket-link";

// The one place the stored Jira connection is opened. Everything that needs
// the address or the token asks here, so the decrypted values pass through as
// few hands as possible and never leave the server.

/** The saved address, readable. Null when none is saved, or it will not decrypt. */
export async function jiraBaseUrl(userId: string): Promise<string | null> {
  const { baseUrlEnc } = await getJiraSecretsEnc(userId);
  if (!baseUrlEnc) return null;
  // Vetted on the way out as well: a row edited by hand must not become a place the token is sent.
  return jiraBaseFromUrl(decryptSecret(baseUrlEnc));
}

export type JiraConnection =
  | { state: "none" }
  /** Something is saved, but it no longer opens: the server's secret changed, or the row was edited. */
  | { state: "unreadable" }
  | { state: "ready"; baseUrl: string; token: string };

/** What is saved, telling "nothing yet" from "saved, and no longer readable": the two need different words. */
export async function jiraConnection(userId: string): Promise<JiraConnection> {
  const { baseUrlEnc, tokenEnc } = await getJiraSecretsEnc(userId);
  if (!baseUrlEnc && !tokenEnc) return { state: "none" };
  const baseUrl = baseUrlEnc ? jiraBaseFromUrl(decryptSecret(baseUrlEnc)) : null;
  const token = tokenEnc ? decryptSecret(tokenEnc) : null;
  return baseUrl && token
    ? { state: "ready", baseUrl, token }
    : { state: "unreadable" };
}

export const JIRA_UNREADABLE =
  "The saved Jira connection can no longer be read. Enter the address and the token again.";

/**
 * Where a linked ticket stands, read from the user's own Jira with their own token.
 *
 * Only a ticket on the connected Jira is asked about. The link may come from
 * the screen: the worst a made-up one can do is name another ticket the same
 * token could already read.
 */
export async function readTicket(
  userId: string,
  link: string,
): Promise<TicketRead> {
  const saved = await jiraConnection(userId);
  if (saved.state === "none") return { state: "no-connection" };
  if (saved.state === "unreadable") {
    return { state: "failed", error: JIRA_UNREADABLE };
  }
  const key = jiraKeyOn(saved.baseUrl, link);
  if (!key) return { state: "elsewhere" };
  const res = await jiraIssue(saved.baseUrl, saved.token, key);
  return res.ok
    ? { state: "ok", facts: res.data }
    : { state: "failed", error: res.error };
}

export type TicketInput =
  | { ok: true; url: string | null }
  | { ok: false; error: string };

/**
 * What a task's ticket box, or an MCP call, was given: a link, a bare ticket
 * number, or nothing.
 *
 * A number alone is enough once a Jira address is saved. Without one it is
 * refused with where to go, since there is nothing to build the link from.
 */
export async function ticketUrlFromInput(
  userId: string,
  raw: string | null | undefined,
): Promise<TicketInput> {
  if (raw === null || raw === undefined || !raw.trim()) {
    return { ok: true, url: null };
  }
  const link = cleanTicketUrl(raw);
  if (link) return { ok: true, url: link };

  const key = ticketKeyFrom(raw);
  if (!key) {
    return {
      ok: false,
      error:
        "That is not a link. Paste the ticket's address, starting with https://, or type its number.",
    };
  }
  const base = await jiraBaseUrl(userId);
  if (!base) {
    return {
      ok: false,
      error:
        "To link a ticket by its number, save your Jira address first: Settings, Connections, Jira.",
    };
  }
  const built = cleanTicketUrl(jiraIssueUrl(base, key));
  return built
    ? { ok: true, url: built }
    : { ok: false, error: "That ticket number could not be turned into a link." };
}

/** The map as stored right now, never a copy shared within the request. */
async function readStatusMapNow(userId: string): Promise<JiraStatusMap> {
  const enc = await getJiraStatusMapEnc(userId);
  const text = enc ? decryptSecret(enc) : null;
  if (!text) return emptyStatusMap();
  try {
    return readStatusMap(JSON.parse(text));
  } catch {
    return emptyStatusMap();
  }
}

/**
 * Which Jira status is which column, and what each column sends. The empty map
 * (Jira's own sorting, nothing sent) when none is saved or it will not open.
 * Shared within a request, so the layout and a page read it once.
 */
export const jiraStatusMap = cache(readStatusMapNow);

/** Keep the map, sealed like the connection beside it. */
export async function saveJiraStatusMap(
  userId: string,
  map: JiraStatusMap,
): Promise<void> {
  await updateSettings(userId, {
    jiraStatusMapEnc: encryptSecret(JSON.stringify(readStatusMap(map))),
  });
}

/**
 * List the statuses a read of Jira met, and give back the map as it stands
 * now. Read again just before it is written: a read of Jira can take seconds,
 * and the map he set meanwhile in Settings must not be written over.
 */
export async function noteJiraStatuses(
  userId: string,
  found: Iterable<KnownStatus>,
): Promise<JiraStatusMap> {
  const now = await readStatusMapNow(userId);
  const grown = withKnown(now, found);
  if (grown) await saveJiraStatusMap(userId, grown);
  return grown ?? now;
}
