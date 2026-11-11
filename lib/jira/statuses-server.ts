import "server-only";

import { listProjects } from "@/lib/db/projects";
import { listTasks } from "@/lib/db/tasks";
import { jiraKeyOn } from "@/lib/jira/address";
import { jiraGet } from "@/lib/jira/client";
import {
  JIRA_UNREADABLE,
  jiraConnection,
  noteJiraStatuses,
} from "@/lib/jira/connection-server";
import { jiraStageOf } from "@/lib/jira/issue";
import {
  STATUS_NAME_MAX,
  type JiraStatusMap,
  type KnownStatus,
} from "@/lib/jira/status-map";

// Every status the Settings tables can list: those of the Jira projects his
// tickets sit in, one request per project, asked only when he presses the button.

/** A person with tickets in more Jira projects than this has the rest listed as reads meet them. */
const PROJECTS_MAX = 10;
const BY_HAND_MS = 60_000;
const ASKED = new Map<string, number>();

export type StatusesRead =
  | { state: "ok"; map: JiraStatusMap; found: number; projects: number }
  | { state: "waiting" }
  | { state: "nothing" }
  | { state: "no-connection" }
  | { state: "failed"; error: string };

/** The Jira project of a ticket number: "PROJ" of "PROJ-12". */
export const projectOf = (key: string) => key.slice(0, key.lastIndexOf("-"));

/** Forget when each person last asked. For tests. */
export function forgetStatusReads(): void {
  ASKED.clear();
}

export async function readJiraStatuses(
  userId: string,
  { now = Date.now() }: { now?: number } = {},
): Promise<StatusesRead> {
  const conn = await jiraConnection(userId);
  if (conn.state === "none") return { state: "no-connection" };
  if (conn.state === "unreadable") return { state: "failed", error: JIRA_UNREADABLE };

  const [tasks, projects] = await Promise.all([listTasks(userId), listProjects(userId)]);
  const keys = new Set<string>();
  for (const link of [...tasks, ...projects].map((row) => row.ticketUrl)) {
    const key = jiraKeyOn(conn.baseUrl, link);
    if (key) keys.add(projectOf(key));
  }
  if (keys.size === 0) return { state: "nothing" };

  if (now - (ASKED.get(userId) ?? -Infinity) < BY_HAND_MS) return { state: "waiting" };
  ASKED.set(userId, now);
  if (ASKED.size > 500) {
    for (const [who, at] of ASKED) if (now - at >= BY_HAND_MS) ASKED.delete(who);
  }

  const found: KnownStatus[] = [];
  const asked = [...keys].sort().slice(0, PROJECTS_MAX);
  let answered = 0;
  let lastError = "";
  for (const project of asked) {
    // The project part of a checked ticket number: letters, digits and underscores only.
    const res = await jiraGet(
      conn.baseUrl,
      conn.token,
      `/rest/api/2/project/${encodeURIComponent(project)}/statuses`,
    );
    if (!res.ok) {
      lastError = res.error;
      // A Jira that turns the token away is not asked about the other projects.
      if (res.why === "refused" || res.why === "sign-in" || res.why === "forbidden") break;
      continue;
    }
    answered += 1;
    // One entry per issue type, each with that type's statuses.
    for (const type of Array.isArray(res.data) ? res.data : []) {
      const statuses = (type as { statuses?: unknown } | null)?.statuses;
      for (const status of Array.isArray(statuses) ? statuses : []) {
        const name = (status as { name?: unknown } | null)?.name;
        if (typeof name !== "string" || !name.trim()) continue;
        found.push({
          name: name.replace(/\s+/g, " ").trim().slice(0, STATUS_NAME_MAX),
          stage: jiraStageOf(status),
        });
      }
    }
  }
  if (answered === 0) return { state: "failed", error: lastError || "Jira did not answer." };

  const map = await noteJiraStatuses(userId, found);
  return {
    state: "ok",
    map,
    found: new Set(found.map((s) => s.name)).size,
    projects: answered,
  };
}
