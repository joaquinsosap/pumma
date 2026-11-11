// Keeping a project in step with Jira: what moves in the store, and how seldom Jira is asked.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import type { TicketStatus } from "@/lib/jira/status-sync";

const jira = vi.hoisted(() => ({
  statuses: new Map<string, unknown>(),
  reads: [] as string[][],
  fail: null as string | null,
  /** Runs while Jira is being read. */
  during: null as null | (() => void),
}));
vi.mock("@/lib/jira/status-read", () => ({
  readTicketStatuses: async (_conn: unknown, keys: string[]) => {
    jira.reads.push([...keys].sort());
    jira.during?.();
    return jira.fail
      ? { ok: false, why: "refused", error: jira.fail }
      : { ok: true, data: { statuses: new Map(jira.statuses), capped: false } };
  },
}));

import { clearJiraConnectionAction, saveJiraConnectionAction } from "@/lib/actions/jira";
import { insertProject } from "@/lib/db/memory/projects";
import { insertTask } from "@/lib/db/memory/tasks";
import { forgetJiraWaits, syncProjectStatuses } from "@/lib/jira/sync-server";
import { getCurrentUserId, getStore, resetStore } from "@/lib/store/memory";

const userId = getCurrentUserId();
const BASE = "https://desk.example.com";
const TOKEN = "NjE2MTYxNjE2MTYxOlRoaXNJc0FUZXN0VG9rZW4";
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 11, 12, 0);

const says = (key: string, status: Partial<TicketStatus>) =>
  jira.statuses.set(key, { name: "Open", stage: "todo", finished: null, ...status });

async function project(title = "Platform") {
  return insertProject({
    userId,
    title,
    description: "",
    color: "oklch(0.6 0.13 155)",
    progress: 0,
    label: "0/0",
    goalId: null,
    tagIds: [],
    lifeArea: "work",
    createdAt: "2026-11-01",
  });
}

async function linked(
  projectId: string | null,
  key: string | null,
  over: {
    status?: "todo" | "doing" | "done";
    ticketStatus?: string;
    /** What is stored, when it was read from another ticket than the one linked now. */
    seenOf?: string;
  } = {},
) {
  return insertTask({
    userId,
    title: `Task for ${key ?? "nothing"}`,
    tagIds: [],
    priority: "med",
    status: over.status ?? "todo",
    due: null,
    projectId,
    goalId: null,
    lifeArea: "work",
    order: 0,
    createdAt: "2026-11-01",
    completedAt: over.status === "done" ? "2026-11-02" : null,
    ticketUrl: key ? `${BASE}/browse/${key}` : null,
    ...(over.ticketStatus ? { ticketSeen: over.seenOf ?? `${key} ${over.ticketStatus}` } : {}),
  });
}

const stored = (id: string) => getStore().tasks.find((t) => t._id === id)!;

beforeEach(async () => {
  resetStore();
  forgetJiraWaits();
  jira.statuses = new Map();
  jira.reads = [];
  jira.fail = null;
  jira.during = null;
  await saveJiraConnectionAction({ address: BASE, token: TOKEN });
});

describe("his status map", () => {
  it("decides where a task goes, and the statuses a read meets are listed", async () => {
    const { saveJiraStatusMapAction } = await import("@/lib/actions/jira");
    const { jiraStatusMap } = await import("@/lib/jira/connection-server");
    await saveJiraStatusMapAction({
      from: { Blocked: "todo" },
      to: { todo: null, doing: null, done: null },
    });
    const p = await project();
    const task = await linked(p.id, "PROJ-1", { status: "doing", ticketStatus: "In Progress" });
    says("PROJ-1", { name: "Blocked", stage: "doing" });

    await syncProjectStatuses(userId, p.id, { now: T0 });

    expect(stored(task.id).status).toBe("todo");
    expect((await jiraStatusMap(userId)).known).toContainEqual({ name: "Blocked", stage: "doing" });
  });

  it("keeps an edit made while Jira was being read", async () => {
    const p = await project();
    const task = await linked(p.id, "PROJ-1", { ticketStatus: "Open" });
    says("PROJ-1", { name: "To Triage", stage: "todo" });
    stored(task.id).updatedAt = "2026-11-01T09:00:00.000Z";
    jira.during = () => {
      stored(task.id).updatedAt = "2026-11-11T11:59:00.000Z";
    };

    await syncProjectStatuses(userId, p.id, { now: T0 });

    expect(stored(task.id)).toMatchObject({
      ticketSeen: "PROJ-1 To Triage",
      updatedAt: "2026-11-11T11:59:00.000Z",
    });
  });
});

describe("reading a project's tickets", () => {
  it("moves a task whose ticket moved, and remembers what Jira said", async () => {
    const p = await project();
    const task = await linked(p.id, "PROJ-1", { ticketStatus: "Open" });
    says("PROJ-1", { name: "In Progress", stage: "doing" });

    const res = await syncProjectStatuses(userId, p.id, { now: T0 });

    expect(res).toMatchObject({ state: "ok", read: 1, moved: 1 });
    expect(stored(task.id)).toMatchObject({
      status: "doing",
      ticketSeen: "PROJ-1 In Progress",
      completedAt: null,
    });
  });

  it("finishes a task on the day Jira closed its ticket, not the day it was read", async () => {
    const p = await project();
    const task = await linked(p.id, "PROJ-1", { status: "doing", ticketStatus: "In Progress" });
    says("PROJ-1", { name: "Closed", stage: "done", finished: "2026-03-01T15:00:00.000Z" });

    await syncProjectStatuses(userId, p.id, { now: T0 });

    expect(stored(task.id)).toMatchObject({ status: "done", completedAt: "2026-03-01" });
  });

  it("reopens a task whose ticket was reopened, and clears its done day", async () => {
    const p = await project();
    const task = await linked(p.id, "PROJ-1", { status: "done", ticketStatus: "Closed" });
    says("PROJ-1", { name: "Reopened", stage: "todo" });

    await syncProjectStatuses(userId, p.id, { now: T0 });

    expect(stored(task.id)).toMatchObject({ status: "todo", completedAt: null });
  });

  it("leaves a task where it was put here while its ticket has not moved", async () => {
    const p = await project();
    const task = await linked(p.id, "PROJ-1", { status: "done", ticketStatus: "Open" });
    says("PROJ-1", { name: "Open", stage: "todo" });

    const res = await syncProjectStatuses(userId, p.id, { now: T0 });

    expect(res).toMatchObject({ state: "ok", moved: 0 });
    expect(stored(task.id)).toMatchObject({ status: "done", completedAt: "2026-11-02" });
  });

  it("takes Jira at its word for a ticket it has never read", async () => {
    const p = await project();
    const task = await linked(p.id, "PROJ-1");
    says("PROJ-1", { name: "Closed", stage: "done" });

    const res = await syncProjectStatuses(userId, p.id, { now: T0 });

    expect(res).toMatchObject({ moved: 1 });
    expect(stored(task.id)).toMatchObject({ status: "done", ticketSeen: "PROJ-1 Closed" });
  });

  it("starts over for a task linked to another ticket since the last read", async () => {
    const p = await project();
    const task = await linked(p.id, "PROJ-2", {
      ticketStatus: "Closed",
      seenOf: "PROJ-1 Closed",
    });
    says("PROJ-2", { name: "Closed", stage: "done" });

    const res = await syncProjectStatuses(userId, p.id, { now: T0 });

    expect(res).toMatchObject({ moved: 1 });
    expect(stored(task.id)).toMatchObject({ status: "done", ticketSeen: "PROJ-2 Closed" });
  });

  it("does not count remembering what Jira said as an edit", async () => {
    const p = await project();
    const task = await linked(p.id, "PROJ-1");
    getStore().tasks.find((t) => t._id === task.id)!.updatedAt = "2026-10-01T08:00:00.000Z";
    says("PROJ-1", { name: "Open", stage: "todo" });

    await syncProjectStatuses(userId, p.id, { now: T0 });

    expect(stored(task.id)).toMatchObject({
      ticketSeen: "PROJ-1 Open",
      updatedAt: "2026-10-01T08:00:00.000Z",
    });
  });

  it("stamps a task it moves, since that is a change", async () => {
    const p = await project();
    const task = await linked(p.id, "PROJ-1", { ticketStatus: "Open" });
    getStore().tasks.find((t) => t._id === task.id)!.updatedAt = "2026-10-01T08:00:00.000Z";
    says("PROJ-1", { name: "In Progress", stage: "doing" });

    await syncProjectStatuses(userId, p.id, { now: T0 });

    expect(stored(task.id).updatedAt).not.toBe("2026-10-01T08:00:00.000Z");
  });

  it("asks only about this project's tickets on the connected Jira", async () => {
    const p = await project();
    const other = await project("Elsewhere");
    await linked(p.id, "PROJ-1");
    await linked(p.id, "PROJ-2");
    await linked(other.id, "PROJ-9");
    await linked(p.id, null);
    await insertTask({
      userId,
      title: "On another tracker",
      tagIds: [],
      priority: "med",
      status: "todo",
      due: null,
      projectId: p.id,
      goalId: null,
      lifeArea: "work",
      order: 0,
      createdAt: "2026-11-01",
      completedAt: null,
      ticketUrl: "https://tracker.example.org/browse/ELSE-1",
    });

    await syncProjectStatuses(userId, p.id, { now: T0 });

    expect(jira.reads).toEqual([["PROJ-1", "PROJ-2"]]);
  });

  it("does not touch another project's task that holds the same ticket", async () => {
    const p = await project();
    const other = await project("Elsewhere");
    await linked(p.id, "PROJ-1");
    const twin = await linked(other.id, "PROJ-1");
    says("PROJ-1", { name: "Closed", stage: "done" });

    await syncProjectStatuses(userId, p.id, { now: T0 });

    expect(stored(twin.id).status).toBe("todo");
  });
});

describe("how seldom Jira is asked", () => {
  it("is not asked again inside the wait, which is ten to twenty minutes", async () => {
    const p = await project();
    await linked(p.id, "PROJ-1");
    says("PROJ-1", {});

    const first = await syncProjectStatuses(userId, p.id, { now: T0 });
    if (first.state !== "ok") throw new Error("expected a read");
    expect(first.nextAt - T0).toBeGreaterThanOrEqual(10 * MIN);
    expect(first.nextAt - T0).toBeLessThanOrEqual(20 * MIN);

    const again = await syncProjectStatuses(userId, p.id, { now: T0 + 9 * MIN });
    expect(again).toEqual({ state: "waiting", nextAt: first.nextAt });
    expect(jira.reads).toHaveLength(1);

    const later = await syncProjectStatuses(userId, p.id, { now: first.nextAt });
    expect(later.state).toBe("ok");
    expect(jira.reads).toHaveLength(2);
  });

  it("reads now when asked by hand, but not twice in a minute", async () => {
    const p = await project();
    await linked(p.id, "PROJ-1");
    says("PROJ-1", {});
    await syncProjectStatuses(userId, p.id, { now: T0 });

    const tooSoon = await syncProjectStatuses(userId, p.id, {
      byHand: true,
      now: T0 + 30_000,
    });
    expect(tooSoon).toEqual({ state: "waiting", nextAt: T0 + MIN });

    const byHand = await syncProjectStatuses(userId, p.id, {
      byHand: true,
      now: T0 + MIN,
    });
    expect(byHand.state).toBe("ok");
    expect(jira.reads).toHaveLength(2);
  });

  it("keeps a wait per project", async () => {
    const p = await project();
    const other = await project("Elsewhere");
    await linked(p.id, "PROJ-1");
    await linked(other.id, "PROJ-2");

    await syncProjectStatuses(userId, p.id, { now: T0 });
    const res = await syncProjectStatuses(userId, other.id, { now: T0 + 1 });

    expect(res.state).toBe("ok");
    expect(jira.reads).toHaveLength(2);
  });

  it("makes a second window asking at the same moment wait", async () => {
    const p = await project();
    await linked(p.id, "PROJ-1");

    const [a, b] = await Promise.all([
      syncProjectStatuses(userId, p.id, { now: T0 }),
      syncProjectStatuses(userId, p.id, { now: T0 }),
    ]);

    expect([a.state, b.state].sort()).toEqual(["ok", "waiting"]);
    expect(jira.reads).toHaveLength(1);
  });

  it("backs off for two minutes after a failed read, and changes nothing", async () => {
    const p = await project();
    const task = await linked(p.id, "PROJ-1");
    jira.fail = "Jira did not accept that token.";

    const res = await syncProjectStatuses(userId, p.id, { now: T0 });
    expect(res).toEqual({
      state: "failed",
      error: "Jira did not accept that token.",
      nextAt: T0 + 2 * MIN,
    });
    expect(stored(task.id).status).toBe("todo");

    jira.fail = null;
    expect(
      (await syncProjectStatuses(userId, p.id, { now: T0 + MIN })).state,
    ).toBe("waiting");
    expect(
      (await syncProjectStatuses(userId, p.id, { now: T0 + 2 * MIN })).state,
    ).toBe("ok");
  });
});

describe("when there is nothing to read", () => {
  it("asks Jira nothing for a project that holds no ticket", async () => {
    const p = await project();
    await linked(p.id, null);

    expect(await syncProjectStatuses(userId, p.id, { now: T0 })).toEqual({
      state: "nothing",
    });
    expect(jira.reads).toEqual([]);
  });

  it("says so when no Jira is connected", async () => {
    const p = await project();
    await linked(p.id, "PROJ-1");
    await clearJiraConnectionAction();

    expect(await syncProjectStatuses(userId, p.id, { now: T0 })).toEqual({
      state: "no-connection",
    });
    expect(jira.reads).toEqual([]);
  });
});
