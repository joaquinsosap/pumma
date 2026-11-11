import "server-only";

import { jiraGet, type JiraAnswer } from "@/lib/jira/client";
import { jiraFactsFrom } from "@/lib/jira/issue";
import { momentFrom, type JiraConn } from "@/lib/jira/pull-read";
import type { TicketStatus } from "@/lib/jira/status-sync";
import { ticketKeyFrom } from "@/lib/ticket-link";

// Where a set of tickets stand, in as few requests as that takes: one search
// per fifty tickets, asking for the status and the closing date and nothing else.

const PAGE = 50;
/** A project with more linked tickets than this has the rest read on a later turn. */
const MAX_SEARCHES = 4;

export type StatusRead = {
  statuses: Map<string, TicketStatus>;
  /** There were more tickets than one read takes. */
  capped: boolean;
};

export async function readTicketStatuses(
  conn: JiraConn,
  keys: readonly string[],
): Promise<JiraAnswer<StatusRead>> {
  // Each number is checked to be a ticket number before it goes into the search.
  const numbers = [
    ...new Set(keys.map((k) => ticketKeyFrom(k)).filter((k): k is string => !!k)),
  ];
  const statuses = new Map<string, TicketStatus>();
  const groups: string[][] = [];
  for (let i = 0; i < numbers.length; i += PAGE) {
    groups.push(numbers.slice(i, i + PAGE));
  }
  let refused: Extract<JiraAnswer<never>, { ok: false }> | null = null;
  let answered = 0;
  for (const group of groups.slice(0, MAX_SEARCHES)) {
    const jql = `key in (${group.join(", ")})`;
    const res = await jiraGet(
      conn.baseUrl,
      conn.token,
      // validateQuery=false: a number this token cannot see is skipped, not a reason to refuse the lot.
      `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=status,resolutiondate&maxResults=${PAGE}&validateQuery=false`,
    );
    if (!res.ok) {
      // A Jira that refuses one group over one ticket still answers for the others. Anything else stops here.
      if (res.why !== "error") return res;
      refused = res;
      continue;
    }
    const issues = (res.data as { issues?: unknown } | null)?.issues;
    if (!Array.isArray(issues)) {
      return { ok: false, why: "not-jira", error: "That address answered, but not like a Jira." };
    }
    answered += 1;
    for (const raw of issues) {
      const facts = jiraFactsFrom(raw);
      if (!facts?.status) continue;
      const fields = (raw as { fields?: { resolutiondate?: unknown } }).fields;
      statuses.set(facts.key, {
        name: facts.status,
        stage: facts.stage,
        finished: momentFrom(fields?.resolutiondate),
      });
    }
  }
  if (refused && answered === 0) return refused;
  return { ok: true, data: { statuses, capped: groups.length > MAX_SEARCHES } };
}
