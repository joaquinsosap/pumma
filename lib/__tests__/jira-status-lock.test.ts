// A task whose ticket is somebody else's in Jira: its status follows Jira, and nothing here changes it.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { POST as notificationAction } from "@/app/api/notifications/[id]/[action]/route";
import { applyChangesetAction, undoChangesetAction } from "@/lib/actions/changeset";
import { startTaskTimer } from "@/lib/actions/task-timer";
import { upsertNotification } from "@/lib/db/memory/notifications";
import { clearJiraConnectionAction, saveJiraConnectionAction } from "@/lib/actions/jira";
import {
  bulkUpdateTasks,
  moveTaskOnBoard,
  moveTaskStatus,
  toggleTask,
  updateTaskDetail,
} from "@/lib/actions/tasks";
import { getSettings } from "@/lib/db/memory/settings";
import { insertTask } from "@/lib/db/memory/tasks";
import { statusLockLine } from "@/lib/jira/status-lock";
import { MCP_SCOPE } from "@/lib/mcp/config";
import type { McpCaller } from "@/lib/mcp/context";
import { runTool } from "@/lib/mcp/registry";
import { completeTask, updateTask as updateTaskTool } from "@/lib/mcp/tools/write";
import { getCurrentUserId, getStore, resetStore } from "@/lib/store/memory";

const userId = getCurrentUserId();
const BASE = "https://desk.example.com";
const TOKEN = "NjE2MTYxNjE2MTYxOlRoaXNJc0FUZXN0VG9rZW4";
const LOCK = "PROJ-1 is not assigned to you in Jira, so its status follows Jira.";

async function linked(mine: boolean | null, status: "todo" | "doing" | "done" = "doing") {
  return insertTask({
    userId,
    title: "A ticket's task",
    tagIds: [],
    priority: "med",
    status,
    due: null,
    projectId: null,
    goalId: null,
    lifeArea: "work",
    order: 0,
    createdAt: "2026-11-01",
    completedAt: status === "done" ? "2026-11-02" : null,
    ticketUrl: `${BASE}/browse/PROJ-1`,
    ticketMine: mine,
  });
}

const stored = (id: string) => getStore().tasks.find((t) => t._id === id)!;

async function caller(): Promise<McpCaller> {
  const settings = (await getSettings(userId))!;
  return {
    userId,
    clientId: "test-client",
    scopes: new Set([MCP_SCOPE.read, MCP_SCOPE.write]),
    settings: { ...settings, mcp: { ...settings.mcp, enabled: true } },
    timeZone: "UTC",
  };
}
const reply = (result: unknown) =>
  (result as { structuredContent: { result: Record<string, unknown> } }).structuredContent.result;

beforeEach(async () => {
  resetStore();
  await saveJiraConnectionAction({ address: BASE, token: TOKEN });
});

describe("the rule", () => {
  const task = { ticketUrl: `${BASE}/browse/PROJ-1`, ticketMine: false };

  it("locks a Jira ticket last read as somebody else's", () => {
    expect(statusLockLine(task, true)).toBe(LOCK);
  });

  it("leaves his own tickets, tickets never read, and other links alone", () => {
    expect(statusLockLine({ ...task, ticketMine: true }, true)).toBeNull();
    expect(statusLockLine({ ...task, ticketMine: null }, true)).toBeNull();
    expect(statusLockLine({ ...task, ticketUrl: "https://example.org/x" }, true)).toBeNull();
  });

  it("lifts with the Jira connection: nothing reads Jira then", () => {
    expect(statusLockLine(task, false)).toBeNull();
  });
});

describe("somebody else's ticket", () => {
  it("cannot be ticked, moved in the panel or dragged to another column", async () => {
    const t = await linked(false);

    expect(await toggleTask(t.id, true)).toEqual({ ok: false, error: LOCK });
    expect(await moveTaskStatus(t.id, "done")).toEqual({ ok: false, error: LOCK });
    expect(await moveTaskOnBoard({ id: t.id, status: "todo", columnIds: [t.id] })).toEqual({
      ok: false,
      error: LOCK,
    });
    expect(stored(t.id).status).toBe("doing");
  });

  it("can still be reordered within its column, and edited otherwise", async () => {
    const t = await linked(false);

    expect((await moveTaskOnBoard({ id: t.id, status: "doing", columnIds: [t.id] })).ok).toBe(true);
    expect((await updateTaskDetail({ id: t.id, title: "Renamed" })).ok).toBe(true);
    expect(stored(t.id).title).toBe("Renamed");
  });

  it("keeps its status in a bulk edit while the rest of the batch applies", async () => {
    const theirs = await linked(false);
    const mine = await linked(true);

    const res = await bulkUpdateTasks({ ids: [theirs.id, mine.id], status: "done", priority: "high" });

    expect(res).toMatchObject({ ok: true, data: { leftToJira: 1 } });
    expect(stored(theirs.id)).toMatchObject({ status: "doing", priority: "high" });
    expect(stored(mine.id)).toMatchObject({ status: "done", priority: "high" });
  });

  it("cannot be moved through MCP", async () => {
    const t = await linked(false);

    const update = reply(
      await runTool(updateTaskTool, await caller())(
        updateTaskTool.inputSchema.parse({ id: t.id, status: "todo" }),
      ),
    );
    const complete = reply(
      await runTool(completeTask, await caller())(completeTask.inputSchema.parse({ id: t.id })),
    );

    expect(update.ok).toBe(false);
    expect(complete.ok).toBe(false);
    expect(stored(t.id).status).toBe("doing");
  });

  it("keeps its status when the assistant's change also renames it", async () => {
    const t = await linked(false);

    const res = await applyChangesetAction({
      summary: "Finish it",
      ops: [
        {
          op: "update",
          entity: "task",
          id: t.id,
          label: "A ticket's task",
          fields: { status: "done", title: "Wrapped up" },
          before: { status: "doing", title: "A ticket's task" },
        },
      ],
    });

    expect(res.ok && res.data?.skipped).toEqual([{ label: "A ticket's task", reason: LOCK }]);
    expect(stored(t.id)).toMatchObject({ status: "doing", title: "Wrapped up" });
  });
});

describe("the side doors", () => {
  it("starting the timer on a To do task leaves it in To do", async () => {
    const t = await linked(false, "todo");

    expect((await startTaskTimer(t.id)).ok).toBe(true);

    expect(stored(t.id)).toMatchObject({ status: "todo" });
    expect(stored(t.id).timerStartedAt).not.toBeNull();
  });

  it("Done on a reminder leaves the task open and says why", async () => {
    const t = await linked(false, "todo");
    await upsertNotification({
      _id: "n1",
      userId,
      kind: "task",
      entityId: t.id,
      entityDate: "",
      leadMins: 0,
      fireAt: "2026-11-11T12:00:00.000Z",
      status: "sent",
      title: "A ticket's task",
      body: "",
      url: "/tasks",
      joinUrl: "",
      sentAt: "2026-11-11T12:00:00.000Z",
      readAt: null,
      createdAt: "2026-11-11T11:00:00.000Z",
    });

    const res = await notificationAction(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ id: "n1", action: "done" }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: LOCK });
    expect(stored(t.id).status).toBe("todo");
  });

  it("undoing the assistant's change puts back everything but the status", async () => {
    const t = await linked(false);

    const res = await undoChangesetAction({
      created: [],
      updated: [{ entity: "task", id: t.id, before: { status: "done", title: "Old title" } }],
    });

    expect(res.ok).toBe(true);
    expect(stored(t.id)).toMatchObject({ status: "doing", title: "Old title" });
  });

  it("MCP keeps the status but still renames the task when asked for both", async () => {
    const t = await linked(false);

    const res = reply(
      await runTool(updateTaskTool, await caller())(
        updateTaskTool.inputSchema.parse({ id: t.id, status: "done", title: "Renamed by MCP" }),
      ),
    );

    expect(res.ok).toBe(true);
    expect(stored(t.id)).toMatchObject({ status: "doing", title: "Renamed by MCP" });
  });
});

describe("his own ticket, or one never read", () => {
  it("moves as any task does", async () => {
    const mine = await linked(true);
    const unread = await linked(null);

    expect((await moveTaskStatus(mine.id, "done")).ok).toBe(true);
    expect((await toggleTask(unread.id, true)).ok).toBe(true);
  });
});

describe("whose a ticket is", () => {
  it("is forgotten when the task is linked to another ticket", async () => {
    const t = await linked(false);

    await updateTaskDetail({ id: t.id, ticketUrl: `${BASE}/browse/PROJ-2` });

    expect(stored(t.id).ticketMine).toBeNull();
  });

  it("is forgotten when another Jira is connected, and kept for a new token on the same one", async () => {
    const t = await linked(false);

    await saveJiraConnectionAction({ address: BASE, token: `${TOKEN}x` });
    expect(stored(t.id).ticketMine).toBe(false);

    await saveJiraConnectionAction({ address: "https://other.example.org", token: TOKEN });
    expect(stored(t.id).ticketMine).toBeNull();
  });

  it("stops locking once the connection is removed", async () => {
    const t = await linked(false);
    await clearJiraConnectionAction();

    expect((await moveTaskStatus(t.id, "done")).ok).toBe(true);
  });
});
