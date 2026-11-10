// A task's ticket link through every door that can write one: the panel's save, an undone delete, and the MCP.
// The link ends up in an href, so each door has to refuse what is not a link.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { undoDeleteTask, updateTaskDetail } from "@/lib/actions/tasks";
import type { McpCaller } from "@/lib/mcp/context";
import { MCP_SCOPE } from "@/lib/mcp/config";
import { getTaskTool } from "@/lib/mcp/tools/collections";
import { createTask, setTaskTicket } from "@/lib/mcp/tools/write";
import { getSettings } from "@/lib/db/memory/settings";
import { insertTask } from "@/lib/db/memory/tasks";
import { getCurrentUserId, getStore, resetStore } from "@/lib/store/memory";

const userId = getCurrentUserId();
const JIRA = "https://jira.example.com/browse/VST-1234";

const makeTask = () =>
  insertTask({
    userId,
    title: "Ship the alert rules",
    tagIds: [],
    priority: "med",
    status: "todo",
    due: null,
    projectId: null,
    goalId: null,
    lifeArea: "work",
    order: 0,
    createdAt: "2026-11-10",
    completedAt: null,
  });
const stored = (id: string) => getStore().tasks.find((t) => t._id === id)!;

describe("the task panel's save", () => {
  beforeEach(() => resetStore());

  it("keeps a pasted ticket link", async () => {
    const task = await makeTask();
    const res = await updateTaskDetail({ id: task.id, ticketUrl: `  ${JIRA} ` });
    expect(res.ok).toBe(true);
    expect(stored(task.id).ticketUrl).toBe(JIRA);
  });

  it.each([
    ["a script", "javascript:alert(document.cookie)"],
    ["a bare key", "VST-1234"],
    ["a link carrying a password", "https://me:pw@jira.example.com/browse/VST-1"],
  ])("refuses %s and leaves the task as it was", async (_what, bad) => {
    const task = await makeTask();
    await updateTaskDetail({ id: task.id, ticketUrl: JIRA });
    const res = await updateTaskDetail({ id: task.id, ticketUrl: bad });
    expect(res.ok).toBe(false);
    expect(stored(task.id).ticketUrl).toBe(JIRA);
  });

  it("takes the link off when the box is cleared", async () => {
    const task = await makeTask();
    await updateTaskDetail({ id: task.id, ticketUrl: JIRA });
    expect((await updateTaskDetail({ id: task.id, ticketUrl: "  " })).ok).toBe(true);
    expect(stored(task.id).ticketUrl).toBeNull();
    await updateTaskDetail({ id: task.id, ticketUrl: JIRA });
    expect((await updateTaskDetail({ id: task.id, ticketUrl: null })).ok).toBe(true);
    expect(stored(task.id).ticketUrl).toBeNull();
  });

  it("leaves the link alone when a save is about something else", async () => {
    const task = await makeTask();
    await updateTaskDetail({ id: task.id, ticketUrl: JIRA });
    await updateTaskDetail({ id: task.id, priority: "high" });
    expect(stored(task.id).ticketUrl).toBe(JIRA);
  });
});

describe("undoing a delete", () => {
  beforeEach(() => resetStore());

  it("puts the task back with its link", async () => {
    const task = await makeTask();
    await updateTaskDetail({ id: task.id, ticketUrl: JIRA });
    const snapshot = JSON.stringify({ ...task, ticketUrl: JIRA });
    getStore().tasks = getStore().tasks.filter((t) => t._id !== task.id);

    expect((await undoDeleteTask(snapshot)).ok).toBe(true);
    expect(stored(task.id).ticketUrl).toBe(JIRA);
  });

  it("drops a link the browser's copy of the task should never have held", async () => {
    const task = await makeTask();
    // The snapshot comes back from the browser, so anything can be in it.
    const snapshot = JSON.stringify({ ...task, ticketUrl: "javascript:alert(1)" });
    getStore().tasks = getStore().tasks.filter((t) => t._id !== task.id);

    expect((await undoDeleteTask(snapshot)).ok).toBe(true);
    expect(stored(task.id).ticketUrl).toBeNull();
  });
});

describe("the MCP", () => {
  beforeEach(() => resetStore());

  const caller = async (): Promise<McpCaller> => {
    const settings = (await getSettings(userId))!;
    return {
      userId,
      clientId: "test-client",
      scopes: new Set([MCP_SCOPE.read, MCP_SCOPE.write]),
      settings: { ...settings, mcp: { ...settings.mcp, enabled: true } },
      timeZone: "UTC",
    };
  };
  type Ticket = { key: string | null; url: string } | null;
  const read = async (id: string) =>
    (await getTaskTool.handler({ id }, await caller())) as {
      text: string;
      data: { ticket: Ticket };
    };
  const link = async (input: unknown) =>
    (await setTaskTicket.handler(
      setTaskTicket.inputSchema.parse(input),
      await caller(),
    )) as { text: string; data: { ok: boolean; ticket?: Ticket } };

  it("links a task and reads the key back", async () => {
    const task = await makeTask();
    const out = await link({ id: task.id, url: JIRA });
    expect(out.data).toMatchObject({ ok: true, ticket: { key: "VST-1234", url: JIRA } });

    const got = await read(task.id);
    expect(got.data.ticket).toEqual({ key: "VST-1234", url: JIRA });
    expect(got.text).toContain("Ticket: VST-1234");
  });

  it("says a task has no ticket when it has none", async () => {
    const task = await makeTask();
    expect((await read(task.id)).data.ticket).toBeNull();
  });

  it("takes the link off when sent null", async () => {
    const task = await makeTask();
    await link({ id: task.id, url: JIRA });
    const out = await link({ id: task.id, url: null });
    expect(out.data).toMatchObject({ ok: true, ticket: null });
    expect(stored(task.id).ticketUrl).toBeNull();
  });

  it("refuses what is not a link and changes nothing", async () => {
    const task = await makeTask();
    await link({ id: task.id, url: JIRA });
    const out = await link({ id: task.id, url: "javascript:alert(1)" });
    expect(out.data.ok).toBe(false);
    expect(stored(task.id).ticketUrl).toBe(JIRA);
  });

  it("answers plainly for a task that is not this user's", async () => {
    const out = await link({ id: "0".repeat(24), url: JIRA });
    expect(out.data.ok).toBe(false);
  });

  it("creates a task already linked", async () => {
    const out = (await createTask.handler(
      createTask.inputSchema.parse({ title: "From a ticket", ticketUrl: JIRA }),
      await caller(),
    )) as { data: { ok: boolean; id: string } };
    expect(out.data.ok).toBe(true);
    expect(stored(out.data.id).ticketUrl).toBe(JIRA);
  });

  it("creates nothing when the link is not one", async () => {
    const before = getStore().tasks.length;
    const out = (await createTask.handler(
      createTask.inputSchema.parse({ title: "Bad link", ticketUrl: "VST-1" }),
      await caller(),
    )) as { data: { ok: boolean } };
    expect(out.data.ok).toBe(false);
    expect(getStore().tasks.length).toBe(before);
  });
});
