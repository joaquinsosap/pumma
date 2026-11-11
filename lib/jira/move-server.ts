import "server-only";

import { getTasksByIds, updateTask } from "@/lib/db/tasks";
import { jiraKeyOn } from "@/lib/jira/address";
import { jiraMoveTicket, jiraTicketMoves } from "@/lib/jira/client";
import {
  JIRA_UNREADABLE,
  jiraConnection,
  jiraStatusMap,
  noteJiraStatuses,
} from "@/lib/jira/connection-server";
import { finishedDay } from "@/lib/jira/pull-plan";
import { myJiraIds } from "@/lib/jira/pull-read";
import { columnOfStatus, planMove } from "@/lib/jira/status-map";
import { syncGoalsForProject } from "@/lib/goal-sync-server";
import { userToday } from "@/lib/timezone-server";
import { seenLine, stepSeenFor } from "@/lib/jira/status-sync";

// Moving a task moves its ticket: the column the task is in now is sent to
// Jira as the status Settings says that column sends.
//
// This is the one place PUMMA writes to a Jira, with its owner's token, so
// every move asks Jira first what the ticket allows from where it stands, and
// sends only a move whose end is the status he picked. Nothing is guessed: a
// move Jira does not offer, or one that wants more than a status, is left
// undone and said.

export type JiraMove =
  /** Jira took the move. */
  | { state: "sent"; key: string; status: string }
  /** The ticket already stands in a status that lands in the task's column, and was left there. */
  | { state: "already"; key: string; status: string }
  /** The task's column sends nothing. */
  | { state: "off" }
  /** The task holds no ticket of the connected Jira. */
  | { state: "no-ticket" }
  | { state: "no-connection" }
  /** More moves in a minute than PUMMA sends: the ticket was left alone this time. */
  | { state: "held"; error: string }
  /** Jira would not make this move. Nothing changed there. */
  | { state: "refused"; key: string; error: string }
  /** The ticket is somebody else's, or nobody's: nothing was sent, and the task went back to where Jira has it. */
  | { state: "not-yours"; key: string; status: string; error: string }
  | { state: "failed"; error: string };

/** Moves sent per person per minute at most. Dragging cards around is not a reason to hammer an employer's Jira. */
const SENDS_PER_MINUTE = 20;
const MINUTE = 60_000;
const PEOPLE_KEPT = 500;

const SENT = new Map<string, number[]>();
/** One move per task at a time: a task dragged twice in a second sends in the order it was dragged. */
const RUNNING = new Map<string, Promise<JiraMove>>();

/** Room for one more send this minute, counted when given. */
function mayAsk(userId: string, now: number): boolean {
  const recent = (SENT.get(userId) ?? []).filter((at) => now - at < MINUTE);
  if (recent.length >= SENDS_PER_MINUTE) {
    SENT.set(userId, recent);
    return false;
  }
  if (!SENT.has(userId) && SENT.size >= PEOPLE_KEPT) {
    for (const [who, times] of SENT) {
      if (times.every((at) => now - at >= MINUTE)) SENT.delete(who);
    }
  }
  recent.push(now);
  SENT.set(userId, recent);
  return true;
}

/** Forget the counts. For tests. */
export function forgetJiraSends(): void {
  SENT.clear();
  RUNNING.clear();
}

/** Send the column a task is in now to its ticket in Jira. */
export function sendTaskToJira(
  userId: string,
  taskId: string,
  { now = Date.now() }: { now?: number } = {},
): Promise<JiraMove> {
  const key = `${userId}|${taskId}`;
  const before = RUNNING.get(key) ?? Promise.resolve(null);
  const mine = before
    .catch(() => null)
    .then(() => send(userId, taskId, now))
    .catch(
      (): JiraMove => ({ state: "failed", error: "PUMMA could not finish the move in Jira." }),
    );
  RUNNING.set(key, mine);
  void mine.finally(() => {
    if (RUNNING.get(key) === mine) RUNNING.delete(key);
  });
  return mine;
}

async function send(userId: string, taskId: string, now: number): Promise<JiraMove> {
  const conn = await jiraConnection(userId);
  if (conn.state === "none") return { state: "no-connection" };
  if (conn.state === "unreadable") return { state: "failed", error: JIRA_UNREADABLE };

  const [task] = await getTasksByIds(userId, [taskId]);
  if (!task) return { state: "failed", error: "That task is gone." };
  const key = jiraKeyOn(conn.baseUrl, task.ticketUrl);
  if (!key) return { state: "no-ticket" };

  // A column that sends nothing costs Jira nothing.
  if (!(await jiraStatusMap(userId)).to[task.status]) return { state: "off" };
  if (!mayAsk(userId, now)) {
    return {
      state: "held",
      error: `PUMMA has asked Jira about ${SENDS_PER_MINUTE} moves in the last minute, so ${key} was left alone. Use Send to Jira on the task in a minute.`,
    };
  }

  const moves = await jiraTicketMoves(conn.baseUrl, conn.token, key);
  if (!moves.ok) return { state: "failed", error: moves.error };
  const { current, transitions } = moves.data;
  // Only his own tickets are ever moved. Not knowing who he is on this Jira is reason enough to send nothing.
  const me = await myJiraIds(conn);
  if (!me || !moves.data.assigneeKnown) {
    return {
      state: "failed",
      error: `PUMMA could not tell who ${key} is assigned to in Jira, so nothing was sent.`,
    };
  }
  const mine = moves.data.assigneeIds.some((id) => me.has(id));

  // Asking Jira takes a moment, and meanwhile he may have changed what a
  // column sends or moved the task again: both are read again now.
  const map = await noteJiraStatuses(userId, [current]);
  const [latest] = await getTasksByIds(userId, [taskId]);
  if (!latest || jiraKeyOn(conn.baseUrl, latest.ticketUrl) !== key) {
    return { state: "no-ticket" };
  }

  /** Keep what Jira said as last read, so a later read does not take it for a move made in Jira. */
  const remember = async (status: string) => {
    const [fresh] = await getTasksByIds(userId, [taskId]);
    if (!fresh || jiraKeyOn(conn.baseUrl, fresh.ticketUrl) !== key) return;
    if (stepSeenFor(key, fresh.ticketSeen) === status) return;
    // Not an edit of the task: it keeps the stamp it has right now.
    await updateTask(userId, taskId, {
      ticketSeen: seenLine(key, status),
      updatedAt: fresh.updatedAt ?? null,
    });
  };

  if (!mine) {
    // Somebody else's work: Jira is the only word on it. The task goes back
    // to the column Jira's status lands in, and is locked there from now on.
    const column = columnOfStatus(map, current.name, current.stage);
    const back = column && column !== latest.status ? column : null;
    const { today, timeZone } = await userToday();
    await updateTask(userId, taskId, {
      ticketSeen: seenLine(key, current.name),
      ticketMine: false,
      ...(back
        ? {
            status: back,
            completedAt:
              back === "done" ? finishedDay(moves.data.finished, today, timeZone) : null,
          }
        : { updatedAt: latest.updatedAt ?? null }),
    });
    if (back && latest.projectId) await syncGoalsForProject(userId, latest.projectId);
    const who = moves.data.assignee
      ? `assigned to ${moves.data.assignee}`
      : "not assigned to anyone";
    return {
      state: "not-yours",
      key,
      status: current.name,
      error: `${key} is ${who} in Jira, where it is ${current.name}. Nothing was sent.`,
    };
  }
  if (latest.ticketMine !== true) {
    await updateTask(userId, taskId, { ticketMine: true, updatedAt: latest.updatedAt ?? null });
  }

  const plan = planMove(map, latest.status, current, transitions);
  if (plan.kind === "off") return { state: "off" };
  if (plan.kind === "already") {
    await remember(plan.status);
    return { state: "already", key, status: plan.status };
  }
  if (plan.kind === "not-allowed") {
    await remember(current.name);
    return {
      state: "refused",
      key,
      error: `Jira does not let ${key} go from ${plan.from} to ${plan.status}. Nothing was changed there.`,
    };
  }

  const res = await jiraMoveTicket(conn.baseUrl, conn.token, key, plan.transition);
  if (res.ok) {
    await remember(plan.status);
    return { state: "sent", key, status: plan.status };
  }
  if (res.why === "invalid" && res.wants?.length) {
    // Jira read the move and asked for fields: the ticket stands where it was read.
    await remember(current.name);
    return {
      state: "refused",
      key,
      error: `Jira wants more than a status to move ${key} to ${plan.status}. Nothing was changed there.`,
    };
  }
  // Anything else leaves PUMMA unsure where the ticket stands, so nothing is kept: the next read says.
  if (res.why === "invalid") {
    return {
      state: "refused",
      key,
      error: `Jira turned down moving ${key} to ${plan.status}. It may have moved in Jira a moment ago. Nothing was changed there.`,
    };
  }
  return { state: "failed", error: res.error };
}
