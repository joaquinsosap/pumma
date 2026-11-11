// A task whose ticket is somebody else's in Jira: its status follows Jira and
// cannot be changed here, so nothing in PUMMA moves a colleague's ticket.

import { ticketFromUrl } from "@/lib/ticket-link";

/**
 * Why a task's status is locked, as the screen says it. Null when it is not.
 *
 * Locked while a Jira is connected, the task holds a Jira ticket, and the last
 * read found that ticket assigned to someone else, or to nobody. A ticket never
 * read is not locked: the move itself asks Jira first and sends nothing then.
 */
export function statusLockLine(
  task: { ticketUrl?: string | null; ticketMine?: boolean | null },
  connected: boolean,
): string | null {
  if (!connected || task.ticketMine !== false) return null;
  const ticket = ticketFromUrl(task.ticketUrl);
  if (ticket?.kind !== "jira" || !ticket.key) return null;
  return `${ticket.key} is not assigned to you in Jira, so its status follows Jira.`;
}
