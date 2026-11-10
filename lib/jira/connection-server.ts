import "server-only";

import { decryptSecret } from "@/lib/crypto";
import { getJiraSecretsEnc } from "@/lib/db/settings";
import { jiraBaseFromUrl, jiraIssueUrl } from "@/lib/jira/address";
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
