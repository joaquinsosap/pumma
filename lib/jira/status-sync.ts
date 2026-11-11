// Keeping a task's column in step with its ticket: which side moved, and
// where the task goes. Pure, so the rule can be read and tested on its own.

import type { JiraStage } from "@/lib/jira/issue";

export type TaskColumn = "todo" | "doing" | "done";

/** A ticket's step as Jira gave it. */
export type TicketStatus = {
  /** The step's name in that Jira's own words: "In Review". */
  name: string;
  /** Which of Jira's three buckets the step sits in. Null when Jira did not say. */
  stage: JiraStage | null;
  /** When Jira closed the ticket. Null while it is open, or when Jira kept no date. */
  finished: string | null;
};

/** A task that holds a ticket of the connected Jira. */
export type LinkedTask = {
  id: string;
  /** The ticket's number. */
  key: string;
  status: TaskColumn;
  /** The step's name when the ticket was last read. Absent before the first read. */
  ticketStatus?: string | null;
};

/** The column a step belongs in. Null when nothing says, and then the task stays put. */
export type ColumnOf = (status: TicketStatus) => TaskColumn | null;

/** Jira sorts every step of every workflow into three buckets, and they are PUMMA's three columns. */
export const columnByStage: ColumnOf = (status) => status.stage;

export type StatusChange = {
  id: string;
  key: string;
  /** What to remember as last read. */
  seen: string;
  /** The column to move the task to. Null when it is already there, or the step maps to none. */
  moveTo: TaskColumn | null;
  /** When Jira closed the ticket, for a task that moves to done. */
  finished: string | null;
};

/**
 * What a read of Jira changes here.
 *
 * The step last read is the point both sides are measured from. Jira still
 * saying the same means the ticket has not moved, so wherever the task was put
 * here stands. Jira saying something new means the ticket moved, and the task
 * follows it. A ticket never read before has no such point, and Jira is taken
 * at its word once: a ticket closed since it was brought in would otherwise
 * stay open here for good.
 *
 * A ticket Jira did not hand back (hidden from the token, or gone) changes nothing.
 */
export function planStatusSync(
  tasks: readonly LinkedTask[],
  tickets: ReadonlyMap<string, TicketStatus>,
  columnOf: ColumnOf = columnByStage,
): StatusChange[] {
  const changes: StatusChange[] = [];
  for (const task of tasks) {
    const ticket = tickets.get(task.key);
    if (!ticket || ticket.name === task.ticketStatus) continue;
    const column = columnOf(ticket);
    const moveTo = column && column !== task.status ? column : null;
    changes.push({
      id: task.id,
      key: task.key,
      seen: ticket.name,
      moveTo,
      finished: moveTo === "done" ? ticket.finished : null,
    });
  }
  return changes;
}

/** How long until a project's tickets may be read again: somewhere in the window, so reads never fall into a beat. */
export function nextWait(
  minMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  return Math.round(minMs + (maxMs - minMs) * random());
}
