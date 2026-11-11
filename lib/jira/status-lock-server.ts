import "server-only";

import { getSettings } from "@/lib/db/settings";
import { statusLockLine } from "@/lib/jira/status-lock";

/** The lock line for a task of this person, or null. Connected is read off their settings. */
export async function statusLockOf(
  userId: string,
  task: { ticketUrl?: string | null; ticketMine?: boolean | null },
): Promise<string | null> {
  if (task.ticketMine !== false) return null;
  const settings = await getSettings(userId);
  return statusLockLine(task, Boolean(settings?.jiraTokenLast4));
}
