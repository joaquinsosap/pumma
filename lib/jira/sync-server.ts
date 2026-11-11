import "server-only";

import { listTasks, updateTask } from "@/lib/db/tasks";
import { syncGoalsForProject } from "@/lib/goal-sync-server";
import { jiraKeyOn } from "@/lib/jira/address";
import { JIRA_UNREADABLE, jiraConnection } from "@/lib/jira/connection-server";
import { finishedDay } from "@/lib/jira/pull-plan";
import { readTicketStatuses } from "@/lib/jira/status-read";
import {
  nextWait,
  planStatusSync,
  type LinkedTask,
} from "@/lib/jira/status-sync";
import { userToday } from "@/lib/timezone-server";

// Keeping a project's tasks in step with their tickets, gently.
//
// Jira is read when a project is opened or come back to, never on a timer and
// never while the app is closed. After a read the same project is not read
// again for ten to twenty minutes, the wait drawn at random each time; asking
// by hand reads now, at most once a minute. What keeps the owner from being
// blocked is how few requests that is. The random wait only spaces them.

const WAIT_MIN_MS = 10 * 60_000;
const WAIT_MAX_MS = 20 * 60_000;
/** Asking by hand reads now, this far apart at the closest. */
const BY_HAND_MS = 60_000;
/** After a read that failed: long enough not to knock on a Jira that is down, short enough to notice it is back. */
const FAILED_MS = 2 * 60_000;
const WAITS_KEPT = 500;

export type JiraSync =
  | {
      state: "ok";
      /** Tickets Jira answered for. */
      read: number;
      /** Tasks moved to another column to match their ticket. */
      moved: number;
      /** The project holds more tickets than one read takes. */
      capped: boolean;
      nextAt: number;
    }
  /** Read a moment ago: what is here is what Jira said then. */
  | { state: "waiting"; nextAt: number }
  /** No task of this project holds a ticket of the connected Jira. */
  | { state: "nothing" }
  | { state: "no-connection" }
  | { state: "failed"; error: string; nextAt: number };

// The app runs as one process, so the waits live in memory. A restart forgets
// them, which costs one early read per project.
const WAITS = new Map<string, { readAt: number; nextAt: number }>();

/** Forget every wait. For tests. */
export function forgetJiraWaits(): void {
  WAITS.clear();
}

/**
 * Read where the tickets of one project stand and move its tasks to match.
 * `byHand` is the Jira button: it reads inside the long wait, but not twice in a minute.
 */
export async function syncProjectStatuses(
  userId: string,
  projectId: string,
  { byHand = false, now = Date.now() }: { byHand?: boolean; now?: number } = {},
): Promise<JiraSync> {
  const waitKey = `${userId}|${projectId}`;
  const wait = WAITS.get(waitKey);
  if (wait) {
    const openAt = byHand
      ? Math.min(wait.nextAt, wait.readAt + BY_HAND_MS)
      : wait.nextAt;
    if (now < openAt) return { state: "waiting", nextAt: openAt };
  }
  // Held before anything is awaited, so a second window asking at the same
  // moment waits instead of reading too. Let go again if no read is made.
  if (WAITS.size >= WAITS_KEPT) WAITS.clear();
  WAITS.set(waitKey, { readAt: now, nextAt: now + BY_HAND_MS });
  const letGo = () => {
    if (wait) WAITS.set(waitKey, wait);
    else WAITS.delete(waitKey);
  };

  const conn = await jiraConnection(userId);
  if (conn.state === "none") {
    letGo();
    return { state: "no-connection" };
  }
  if (conn.state === "unreadable") {
    const nextAt = now + FAILED_MS;
    WAITS.set(waitKey, { readAt: now, nextAt });
    return { state: "failed", error: JIRA_UNREADABLE, nextAt };
  }

  const linked: LinkedTask[] = [];
  for (const task of await listTasks(userId)) {
    if (task.projectId !== projectId) continue;
    const key = jiraKeyOn(conn.baseUrl, task.ticketUrl);
    if (!key) continue;
    linked.push({
      id: task.id,
      key,
      status: task.status,
      ticketStatus: task.ticketStatus,
    });
  }
  if (linked.length === 0) {
    letGo();
    return { state: "nothing" };
  }

  const res = await readTicketStatuses(
    conn,
    linked.map((t) => t.key),
  );
  if (!res.ok) {
    const nextAt = now + FAILED_MS;
    WAITS.set(waitKey, { readAt: now, nextAt });
    return { state: "failed", error: res.error, nextAt };
  }

  const changes = planStatusSync(linked, res.data.statuses);
  const { today, timeZone } = await userToday();
  let moved = 0;
  for (const change of changes) {
    const updated = await updateTask(userId, change.id, {
      ticketStatus: change.seen,
      ...(change.moveTo
        ? {
            status: change.moveTo,
            // Done on the day Jira closed it, not the day it was read.
            completedAt:
              change.moveTo === "done"
                ? finishedDay(change.finished, today, timeZone)
                : null,
          }
        : {}),
    });
    if (updated && change.moveTo) moved += 1;
  }
  // A goal's progress is stored, and worked out from the projects under it.
  if (moved > 0) await syncGoalsForProject(userId, projectId);

  const nextAt = now + nextWait(WAIT_MIN_MS, WAIT_MAX_MS);
  WAITS.set(waitKey, { readAt: now, nextAt });
  return {
    state: "ok",
    read: res.data.statuses.size,
    moved,
    capped: res.data.capped,
    nextAt,
  };
}
