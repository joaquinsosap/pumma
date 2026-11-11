// Moving a task moves its ticket: what is asked of Jira, what is sent, and what is kept.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/outbound-guard", () => ({
  whereHostResolves: () => Promise.resolve("public"),
}));

import { saveJiraConnectionAction, saveJiraStatusMapAction } from "@/lib/actions/jira";
import { insertTask } from "@/lib/db/memory/tasks";
import { jiraStatusMap } from "@/lib/jira/connection-server";
import { forgetJiraSends, sendTaskToJira } from "@/lib/jira/move-server";
import { forgetStatusReads, readJiraStatuses } from "@/lib/jira/statuses-server";
import { getCurrentUserId, getStore, resetStore } from "@/lib/store/memory";

const userId = getCurrentUserId();
const BASE = "https://desk.example.com";
const TOKEN = "NjE2MTYxNjE2MTYxOlRoaXNJc0FUZXN0VG9rZW4";
const T0 = Date.UTC(2026, 10, 11, 12, 0);

type Bucket = "new" | "indeterminate" | "done";
const BUCKET: Record<string, Bucket> = {
  Open: "new",
  "In Progress": "indeterminate",
  "In Review": "indeterminate",
  Closed: "done",
};

/** A pretend Jira: where each ticket stands, the moves its workflow offers, and every request it got. */
const jira = {
  status: new Map<string, string>(),
  offers: {
    Open: [{ id: "11", to: "In Progress" }],
    "In Progress": [
      { id: "21", to: "In Review" },
      { id: "31", to: "Closed" },
    ],
    "In Review": [{ id: "31", to: "Closed" }],
    Closed: [{ id: "41", to: "Open" }],
  } as Record<string, { id: string; to: string }[]>,
  /** What a move answers with. */
  moveAnswer: 204,
  /** A 400 that names the fields Jira wants, or one that names none. */
  moveWants: true,
  /** What every request answers with instead, when set: a token Jira refuses, say. */
  everything: null as number | null,
  /** Runs while Jira is being asked where a ticket stands. */
  onRead: null as null | (() => Promise<unknown>),
  calls: [] as { method: string; path: string; body: unknown; headers: Record<string, string> }[],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function answer(url: URL, init: RequestInit): Promise<Response> {
  const method = init.method ?? "GET";
  const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
  jira.calls.push({
    method,
    path: url.pathname + url.search,
    body,
    headers: init.headers as Record<string, string>,
  });
  if (jira.everything) return json({}, jira.everything);
  const issue = url.pathname.match(/^\/rest\/api\/2\/issue\/([A-Z0-9_]+-\d+)(\/transitions)?$/);
  if (issue) {
    const key = issue[1];
    const now = jira.status.get(key);
    if (!now) return json({}, 404);
    if (method === "POST" && issue[2]) {
      if (jira.moveAnswer !== 204) {
        return json(
          jira.moveWants
            ? { errorMessages: [], errors: { resolution: "Resolution is required." } }
            : { errorMessages: ["That move is not valid for where the ticket is now."], errors: {} },
          jira.moveAnswer,
        );
      }
      const move = (jira.offers[now] ?? []).find((t) => t.id === body?.transition?.id);
      if (!move) return json({}, 400);
      jira.status.set(key, move.to);
      return new Response(null, { status: 204 });
    }
    if (jira.onRead) await jira.onRead();
    return json({
      key,
      fields: { status: { name: now, statusCategory: { key: BUCKET[now] } } },
      transitions: (jira.offers[now] ?? []).map((t) => ({
        id: t.id,
        name: `Go to ${t.to}`,
        to: { name: t.to, statusCategory: { key: BUCKET[t.to] } },
      })),
    });
  }
  const statuses = url.pathname.match(/^\/rest\/api\/2\/project\/([A-Z0-9_]+)\/statuses$/);
  if (statuses) {
    return json([
      {
        name: "Story",
        statuses: Object.keys(BUCKET).map((name) => ({ name, statusCategory: { key: BUCKET[name] } })),
      },
      { name: "Bug", statuses: [{ name: "Waiting", statusCategory: { key: "indeterminate" } }] },
    ]);
  }
  return json({}, 404);
}

async function linked(
  key: string | null,
  over: { status?: "todo" | "doing" | "done"; seen?: string; url?: string } = {},
) {
  return insertTask({
    userId,
    title: `Task for ${key ?? "nothing"}`,
    tagIds: [],
    priority: "med",
    status: over.status ?? "todo",
    due: null,
    projectId: null,
    goalId: null,
    lifeArea: "work",
    order: 0,
    createdAt: "2026-11-01",
    completedAt: null,
    ticketUrl: over.url ?? (key ? `${BASE}/browse/${key}` : null),
    ...(over.seen ? { ticketSeen: `${key} ${over.seen}` } : {}),
  });
}

const stored = (id: string) => getStore().tasks.find((t) => t._id === id)!;
const sends = (to: { todo?: string; doing?: string; done?: string }) =>
  saveJiraStatusMapAction({
    from: {},
    to: { todo: to.todo ?? null, doing: to.doing ?? null, done: to.done ?? null },
  });
const posts = () => jira.calls.filter((c) => c.method === "POST");

beforeEach(async () => {
  resetStore();
  forgetJiraSends();
  forgetStatusReads();
  jira.status = new Map();
  jira.moveAnswer = 204;
  jira.moveWants = true;
  jira.everything = null;
  jira.onRead = null;
  jira.calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit) => answer(new URL(String(url)), init)),
  );
  await saveJiraConnectionAction({ address: BASE, token: TOKEN });
});
afterEach(() => vi.unstubAllGlobals());

describe("a move sent to Jira", () => {
  it("makes the move Jira offers to the status the column sends, and remembers it", async () => {
    await sends({ doing: "In Progress" });
    jira.status.set("PROJ-1", "Open");
    const task = await linked("PROJ-1", { status: "doing", seen: "Open" });

    const res = await sendTaskToJira(userId, task.id, { now: T0 });

    expect(res).toEqual({ state: "sent", key: "PROJ-1", status: "In Progress" });
    expect(jira.status.get("PROJ-1")).toBe("In Progress");
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toMatchObject({
      path: "/rest/api/2/issue/PROJ-1/transitions",
      body: { transition: { id: "11" } },
    });
    expect(posts()[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(stored(task.id).ticketSeen).toBe("PROJ-1 In Progress");
  });

  it("costs two requests: what the ticket allows, then the move", async () => {
    await sends({ done: "Closed" });
    jira.status.set("PROJ-1", "In Progress");
    const task = await linked("PROJ-1", { status: "done" });

    await sendTaskToJira(userId, task.id, { now: T0 });

    expect(jira.calls.map((c) => c.method)).toEqual(["GET", "POST"]);
  });

  it("keeps the task's edit stamp as it is at the end: remembering Jira's word is not an edit", async () => {
    await sends({ doing: "In Progress" });
    jira.status.set("PROJ-1", "Open");
    const task = await linked("PROJ-1", { status: "doing" });
    stored(task.id).updatedAt = "2026-01-01T00:00:00.000Z";
    // He renames the task while Jira is being asked: that edit's stamp stands.
    jira.onRead = async () => {
      stored(task.id).updatedAt = "2026-11-11T11:59:00.000Z";
    };

    await sendTaskToJira(userId, task.id, { now: T0 });

    expect(stored(task.id)).toMatchObject({
      ticketSeen: "PROJ-1 In Progress",
      updatedAt: "2026-11-11T11:59:00.000Z",
    });
  });
});

describe("a move that is not sent", () => {
  it("asks Jira nothing when the column leaves Jira alone", async () => {
    await sends({ done: "Closed" });
    const task = await linked("PROJ-1", { status: "doing" });

    expect(await sendTaskToJira(userId, task.id, { now: T0 })).toEqual({ state: "off" });
    expect(jira.calls).toHaveLength(0);
  });

  it("asks Jira nothing before the tables are filled", async () => {
    const task = await linked("PROJ-1", { status: "done" });

    expect(await sendTaskToJira(userId, task.id, { now: T0 })).toEqual({ state: "off" });
    expect(jira.calls).toHaveLength(0);
  });

  it("leaves a ticket that already lands in the task's column where it is", async () => {
    await sends({ doing: "In Progress" });
    jira.status.set("PROJ-1", "In Review");
    const task = await linked("PROJ-1", { status: "doing", seen: "Open" });

    const res = await sendTaskToJira(userId, task.id, { now: T0 });

    expect(res).toEqual({ state: "already", key: "PROJ-1", status: "In Review" });
    expect(posts()).toHaveLength(0);
    expect(stored(task.id).ticketSeen).toBe("PROJ-1 In Review");
  });

  it("says so when Jira offers no way there, and changes nothing in Jira", async () => {
    await sends({ done: "Closed" });
    jira.status.set("PROJ-1", "Open");
    const task = await linked("PROJ-1", { status: "done" });

    const res = await sendTaskToJira(userId, task.id, { now: T0 });

    expect(res).toEqual({
      state: "refused",
      key: "PROJ-1",
      error: "Jira does not let PROJ-1 go from Open to Closed. Nothing was changed there.",
    });
    expect(posts()).toHaveLength(0);
    expect(jira.status.get("PROJ-1")).toBe("Open");
    // The task stays where he put it, and what Jira said is kept, so the chip can mark the two disagreeing.
    expect(stored(task.id)).toMatchObject({ status: "done", ticketSeen: "PROJ-1 Open" });
  });

  it("sends nothing when he turns the column off while Jira is being asked", async () => {
    await sends({ doing: "In Progress" });
    jira.status.set("PROJ-1", "Open");
    jira.onRead = () => sends({});
    const task = await linked("PROJ-1", { status: "doing" });

    expect(await sendTaskToJira(userId, task.id, { now: T0 })).toEqual({ state: "off" });
    expect(posts()).toHaveLength(0);
    expect((await jiraStatusMap(userId)).to.doing).toBeNull();
  });

  it("sends where the task is now when he moved it again while Jira was asked", async () => {
    await sends({ doing: "In Progress", done: "Closed" });
    jira.status.set("PROJ-1", "In Progress");
    const task = await linked("PROJ-1", { status: "doing" });
    jira.onRead = async () => {
      stored(task.id).status = "done";
    };

    expect(await sendTaskToJira(userId, task.id, { now: T0 })).toMatchObject({
      state: "sent",
      status: "Closed",
    });
  });

  it("changes nothing and keeps nothing when Jira refuses the token", async () => {
    await sends({ done: "Closed" });
    jira.everything = 401;
    const task = await linked("PROJ-1", { status: "done", seen: "Open" });

    const res = await sendTaskToJira(userId, task.id, { now: T0 });

    expect(res).toEqual({ state: "failed", error: "Jira did not accept that token." });
    expect(posts()).toHaveLength(0);
    expect(stored(task.id).ticketSeen).toBe("PROJ-1 Open");
  });

  it("keeps nothing when the move itself fails: Jira may or may not have made it", async () => {
    await sends({ done: "Closed" });
    jira.status.set("PROJ-1", "In Review");
    jira.moveAnswer = 500;
    const task = await linked("PROJ-1", { status: "done", seen: "Open" });

    expect((await sendTaskToJira(userId, task.id, { now: T0 })).state).toBe("failed");
    expect(stored(task.id).ticketSeen).toBe("PROJ-1 Open");
  });

  it("tells a move Jira no longer offers from one that wants a field", async () => {
    await sends({ done: "Closed" });
    jira.status.set("PROJ-1", "In Review");
    jira.moveAnswer = 400;
    jira.moveWants = false;
    const task = await linked("PROJ-1", { status: "done", seen: "Open" });

    const res = await sendTaskToJira(userId, task.id, { now: T0 });

    expect(res.state === "refused" && res.error).toMatch(/may have moved in Jira/);
    expect(stored(task.id).ticketSeen).toBe("PROJ-1 Open");
  });

  it("says Jira wants more when a move needs a field filled in", async () => {
    await sends({ done: "Closed" });
    jira.status.set("PROJ-1", "In Review");
    jira.moveAnswer = 400;
    const task = await linked("PROJ-1", { status: "done" });

    const res = await sendTaskToJira(userId, task.id, { now: T0 });

    expect(res).toMatchObject({ state: "refused", key: "PROJ-1" });
    expect(res.state === "refused" && res.error).toMatch(/wants more than a status/);
    // Jira read the move and said no, so the ticket stands where it was read.
    expect(stored(task.id)).toMatchObject({ status: "done", ticketSeen: "PROJ-1 In Review" });
  });

  it("never asks about a ticket on another Jira", async () => {
    await sends({ done: "Closed" });
    const task = await linked("PROJ-1", {
      status: "done",
      url: "https://other.example.org/browse/PROJ-1",
    });

    expect(await sendTaskToJira(userId, task.id, { now: T0 })).toEqual({ state: "no-ticket" });
    expect(jira.calls).toHaveLength(0);
  });

  it("holds off after twenty moves in a minute", async () => {
    await sends({ doing: "In Progress" });
    jira.status.set("PROJ-1", "In Review");
    const task = await linked("PROJ-1", { status: "doing" });

    for (let i = 0; i < 20; i++) await sendTaskToJira(userId, task.id, { now: T0 + i });
    const held = await sendTaskToJira(userId, task.id, { now: T0 + 20 });
    const later = await sendTaskToJira(userId, task.id, { now: T0 + 61_000 });

    expect(held.state).toBe("held");
    expect(later.state).toBe("already");
  });

  it("sends two moves of one task in the order they were made", async () => {
    await sends({ doing: "In Progress", done: "Closed" });
    jira.status.set("PROJ-1", "Open");
    const task = await linked("PROJ-1", { status: "doing" });

    const first = sendTaskToJira(userId, task.id, { now: T0 });
    const second = sendTaskToJira(userId, task.id, { now: T0 + 1 });

    expect(await first).toMatchObject({ state: "sent", status: "In Progress" });
    expect(await second).toMatchObject({ state: "already", status: "In Progress" });
  });
});

describe("statuses for the tables", () => {
  it("are those of the Jira projects his tickets sit in, one request each", async () => {
    await linked("PROJ-1");
    await linked("PROJ-2");
    await linked("OPS-7");

    const res = await readJiraStatuses(userId, { now: T0 });

    expect(res).toMatchObject({ state: "ok", found: 5, projects: 2 });
    expect(jira.calls.map((c) => c.path).sort()).toEqual([
      "/rest/api/2/project/OPS/statuses",
      "/rest/api/2/project/PROJ/statuses",
    ]);
    const map = await jiraStatusMap(userId);
    expect(map.known).toContainEqual({ name: "Waiting", stage: "doing" });
  });

  it("are read at most once a minute", async () => {
    await linked("PROJ-1");
    await readJiraStatuses(userId, { now: T0 });

    expect(await readJiraStatuses(userId, { now: T0 + 30_000 })).toEqual({ state: "waiting" });
    expect(jira.calls).toHaveLength(1);
  });

  it("ask Jira nothing when no ticket is linked", async () => {
    expect(await readJiraStatuses(userId, { now: T0 })).toEqual({ state: "nothing" });
    expect(jira.calls).toHaveLength(0);
  });

  it("keep his answers when more are listed", async () => {
    await linked("PROJ-1");
    await saveJiraStatusMapAction({
      from: { "In Review": "done" },
      to: { todo: null, doing: "In Progress", done: null },
    });

    await readJiraStatuses(userId, { now: T0 });

    const map = await jiraStatusMap(userId);
    expect(map.from).toEqual({ "In Review": "done" });
    expect(map.to.doing).toBe("In Progress");
  });
});

describe("the stored tables", () => {
  it("never reach the screen in their sealed form", async () => {
    await sends({ done: "Closed" });
    const { getSettings } = await import("@/lib/db/memory/settings");
    expect(await getSettings(userId)).not.toHaveProperty("jiraStatusMapEnc");
  });

  it("go when the connection is removed", async () => {
    await sends({ done: "Closed" });
    const { clearJiraConnectionAction } = await import("@/lib/actions/jira");
    await clearJiraConnectionAction();
    expect(getStore().settings[0].jiraStatusMapEnc).toBeNull();
  });

  it("go when another Jira is connected, and stay for a new token on the same one", async () => {
    await sends({ done: "Closed" });
    await saveJiraConnectionAction({ address: BASE, token: `${TOKEN}x` });
    expect((await jiraStatusMap(userId)).to.done).toBe("Closed");

    await saveJiraConnectionAction({ address: "https://other.example.org", token: TOKEN });
    expect((await jiraStatusMap(userId)).to.done).toBeNull();
  });

  it("refuse answers for more statuses than can be listed", async () => {
    const from = Object.fromEntries(
      Array.from({ length: 201 }, (_, i) => [`Status ${i}`, "todo" as const]),
    );
    const res = await saveJiraStatusMapAction({ from, to: { todo: null, doing: null, done: null } });
    expect(res.ok).toBe(false);
  });
});
