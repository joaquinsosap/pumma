// What PUMMA shows of a Jira ticket, read out of Jira's own answer.
//
// Everything here is somebody else's text. It is shown on a task, so each
// value is cut to one bounded line, and anything that is not the expected
// shape is simply absent rather than guessed at.

import { ticketKeyFrom } from "@/lib/ticket-link";

/** Where a ticket stands, in the three buckets every Jira workflow sorts its own steps into. */
export type JiraStage = "todo" | "doing" | "done";

export type JiraTicketFacts = {
  key: string;
  title: string | null;
  /** The step's name as that Jira calls it: "In Review", "Waiting for customer". */
  status: string | null;
  stage: JiraStage | null;
  /** Who has it. Null when nobody does. */
  assignee: string | null;
  type: string | null;
  priority: string | null;
};

/** Jira names its three buckets "new", "indeterminate" and "done". */
const STAGES: Record<string, JiraStage> = {
  new: "todo",
  indeterminate: "doing",
  done: "done",
};

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

/** One line of text, bounded. Null for anything that is not text, or is blank. */
function line(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const text = v.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

/**
 * The facts of one ticket from Jira's answer to "give me this issue".
 * Null when the answer is not an issue at all.
 */
export function jiraFactsFrom(raw: unknown): JiraTicketFacts | null {
  const issue = obj(raw);
  const key = ticketKeyFrom(issue?.key);
  const fields = obj(issue?.fields);
  if (!key || !fields) return null;

  const status = obj(fields.status);
  const category = obj(status?.statusCategory);
  const assignee = obj(fields.assignee);
  const bucket = typeof category?.key === "string" ? category.key : "";

  return {
    key,
    title: line(fields.summary, 300),
    status: line(status?.name, 60),
    stage: STAGES[bucket] ?? null,
    assignee: line(assignee?.displayName, 80) ?? line(assignee?.name, 80),
    type: line(obj(fields.issuetype)?.name, 60),
    priority: line(obj(fields.priority)?.name, 60),
  };
}

/** The fields asked for. Naming them keeps the answer to a few hundred bytes instead of the whole ticket. */
export const JIRA_TICKET_FIELDS = "summary,status,assignee,issuetype,priority";

/** What asking Jira about a task's ticket came to, as the ticket card needs it. */
export type TicketRead =
  | { state: "ok"; facts: JiraTicketFacts }
  /** No Jira is connected: the card says where to connect one. */
  | { state: "no-connection" }
  /** The link points somewhere other than the connected Jira. Nothing is asked, and the token goes nowhere. */
  | { state: "elsewhere" }
  | { state: "failed"; error: string };
