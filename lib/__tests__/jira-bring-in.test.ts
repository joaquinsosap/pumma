// Bringing a pull in: what gets made in the store, what is reused, and how gently Jira is asked.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import type { PullForest, PulledTicket } from "@/lib/jira/pull-plan";

const jira = vi.hoisted(() => ({
  forest: null as unknown,
  reads: 0,
  fail: null as string | null,
  /** The next read blows up outright, as a dropped connection inside the server would. */
  throwOnce: false,
  /** Jira said whose token it is, so the owner's tickets can be told apart. */
  whoKnown: true,
}));
vi.mock("@/lib/jira/pull-read", () => ({
  readPull: async () => {
    jira.reads += 1;
    if (jira.throwOnce) {
      jira.throwOnce = false;
      throw new Error("the read blew up");
    }
    return jira.fail
      ? { ok: false, why: "refused", error: jira.fail }
      : {
          ok: true,
          data: { forest: structuredClone(jira.forest), capped: false, whoKnown: jira.whoKnown },
        };
  },
}));

import { saveJiraConnectionAction } from "@/lib/actions/jira";
import { insertProject } from "@/lib/db/memory/projects";
import { insertTag } from "@/lib/db/memory/tags";
import { forgetPullReads, previewPull, runPull } from "@/lib/jira/pull-server";
import { getCurrentUserId, getStore, resetStore } from "@/lib/store/memory";

const userId = getCurrentUserId();
const BASE = "https://desk.example.com";
const TOKEN = "NjE2MTYxNjE2MTYxOlRoaXNJc0FUZXN0VG9rZW4";

const ticket = (key: string, title: string, stage: PulledTicket["stage"] = "todo"): PulledTicket => ({
  key,
  title,
  stage,
  url: `${BASE}/browse/${key}`,
  mine: false,
  finished: null,
});
const COORD = ticket("COOR-12", "Platform alerts");
const QUEUE = ticket("VST-210", "Queue alerts");
const BOARDS = ticket("VST-214", "Dashboards");
const RULES = ticket("VST-221", "Alert rules for the queue", "doing");
const RUNBOOK = ticket("VST-222", "Write the runbook");
const LATENCY = ticket("VST-230", "Latency board", "done");

const tree = (): PullForest => ({
  coords: [
    {
      ticket: COORD,
      epics: [
        { ticket: QUEUE, stories: [RULES, RUNBOOK] },
        { ticket: BOARDS, stories: [LATENCY] },
      ],
    },
  ],
  epics: [],
  loose: [],
});

const SOURCE = { kind: "ticket" as const, key: "COOR-12", children: true };
/** The selectors wide open: everybody's tickets, at every stage. */
const EVERY = { who: "all" as const, stages: ["todo" as const, "doing" as const, "done" as const] };
const store = () => getStore();
const projectsNamed = (title: string) =>
  store().projects.filter((p) => p.userId === userId && p.title === title);
const tagNamed = (name: string) =>
  store().tags.find((t) => t.userId === userId && t.name === name);
const tasksOf = (projectId: string | null) =>
  store().tasks.filter((t) => t.userId === userId && t.projectId === projectId && t.ticketUrl);
const tagNames = (ids: string[]) =>
  ids.map((id) => store().tags.find((t) => t._id === id)?.name).sort();

const connect = () => saveJiraConnectionAction({ address: BASE, token: TOKEN });

beforeEach(async () => {
  resetStore();
  forgetPullReads();
  jira.forest = tree();
  jira.reads = 0;
  jira.fail = null;
  jira.throwOnce = false;
  jira.whoKnown = true;
  await connect();
});

describe("bringing a COORD in as the project", () => {
  it("makes the project, a tag per epic, and a task per story wearing the right tags", async () => {
    const run = await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY });
    expect(run).toMatchObject({
      state: "ok",
      brought: { projects: 1, tags: 2, tasks: 3, alreadyHere: 0 },
    });

    const [project] = projectsNamed("Platform alerts");
    expect(project).toBeDefined();
    expect(project.ticketUrl).toBe(COORD.url);
    expect(project.lifeArea).toBe("work");
    expect(run.state === "ok" && run.brought.openProjectId).toBe(project._id);

    // The project's own tag, and one per epic that belongs to the project without being its own.
    expect(tagNamed("platform-alerts")).toMatchObject({ projectId: project._id, isProjectPrimary: true });
    expect(tagNamed("queue-alerts")).toMatchObject({ projectId: project._id, isProjectPrimary: false });
    expect(tagNamed("dashboards")).toMatchObject({ projectId: project._id, isProjectPrimary: false });

    const tasks = tasksOf(project._id);
    expect(tasks).toHaveLength(3);
    const rules = tasks.find((t) => t.ticketUrl === RULES.url)!;
    expect(rules).toMatchObject({
      title: "Alert rules for the queue",
      status: "doing",
      lifeArea: "work",
      priority: "med",
      due: null,
      completedAt: null,
    });
    expect(tagNames(rules.tagIds)).toEqual(["platform-alerts", "queue-alerts", "work"]);
    const latency = tasks.find((t) => t.ticketUrl === LATENCY.url)!;
    expect(latency.status).toBe("done");
    expect(latency.completedAt).toBe(latency.createdAt);
    expect(tagNames(latency.tagIds)).toEqual(["dashboards", "platform-alerts", "work"]);
  });

  it("dates a ticket that arrives done on the day Jira closed it, both when it was made and when it was done", async () => {
    const forest = tree();
    forest.coords[0].epics[1].stories[0] = { ...LATENCY, finished: "2026-03-01T10:22:33.000Z" };
    jira.forest = forest;
    await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY });
    const [project] = projectsNamed("Platform alerts");
    const tasks = tasksOf(project._id);
    const latency = tasks.find((t) => t.ticketUrl === LATENCY.url)!;
    expect(latency.completedAt).toBe("2026-03-01");
    expect(latency.createdAt).toBe("2026-03-01");
    // An open ticket beside it is made today and done never.
    const rules = tasks.find((t) => t.ticketUrl === RULES.url)!;
    expect(rules.completedAt).toBeNull();
    expect(rules.createdAt).not.toBe("2026-03-01");
  });

  it("keeps the order Jira gave", async () => {
    await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY });
    const [project] = projectsNamed("Platform alerts");
    const inOrder = [...tasksOf(project._id)].sort((a, b) => a.order - b.order);
    expect(inOrder.map((t) => t.ticketUrl)).toEqual([RULES.url, RUNBOOK.url, LATENCY.url]);
  });

  it("leaves out what was unticked, in whatever case the number comes", async () => {
    await runPull(userId, { source: SOURCE, level: "coord", off: ["vst-222", "VST-214"], ...EVERY });
    const [project] = projectsNamed("Platform alerts");
    expect(tasksOf(project._id).map((t) => t.ticketUrl)).toEqual([RULES.url]);
    expect(tagNamed("dashboards")).toBeUndefined();
  });
});

describe("bringing the same thing in again", () => {
  it("makes nothing twice", async () => {
    await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY });
    const again = await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY });
    expect(again).toMatchObject({
      state: "ok",
      brought: { projects: 0, tags: 0, tasks: 0, alreadyHere: 3 },
    });
    expect(projectsNamed("Platform alerts")).toHaveLength(1);
    expect(store().tags.filter((t) => t.name.startsWith("queue-alerts"))).toHaveLength(1);
    expect(store().tasks.filter((t) => t.ticketUrl === RULES.url)).toHaveLength(1);
  });

  it("adds a story that is new in Jira to the project and the epic tag already here", async () => {
    await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY });
    const [project] = projectsNamed("Platform alerts");
    const more = tree();
    more.coords[0].epics[0].stories.push(ticket("VST-240", "Page the on-call"));
    jira.forest = more;

    const again = await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY });
    expect(again).toMatchObject({ state: "ok", brought: { projects: 0, tags: 0, tasks: 1 } });
    const added = store().tasks.find((t) => t.ticketUrl === `${BASE}/browse/VST-240`)!;
    expect(added.projectId).toBe(project._id);
    expect(tagNames(added.tagIds)).toEqual(["platform-alerts", "queue-alerts", "work"]);
  });

  it("knows a ticket it did not make: a task linked by hand counts as here", async () => {
    store().tasks.unshift({
      ...store().tasks[0],
      _id: "by-hand",
      userId,
      title: "My own note on the rules",
      // A board link with the ticket open, not its page.
      ticketUrl: `${BASE}/secure/RapidBoard.jspa?rapidView=4&selectedIssue=VST-221`,
      projectId: null,
    });
    const run = await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY });
    expect(run).toMatchObject({ state: "ok", brought: { tasks: 2, alreadyHere: 1 } });
    expect(store().tasks.filter((t) => t.ticketUrl === RULES.url)).toHaveLength(0);
  });
});

describe("two bring-ins at once", () => {
  it("make the project and its tasks once: the second waits, and finds them here", async () => {
    const [first, second] = await Promise.all([
      runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY }),
      runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY }),
    ]);
    expect(first).toMatchObject({ state: "ok", brought: { projects: 1, tasks: 3 } });
    expect(second).toMatchObject({ state: "ok", brought: { projects: 0, tasks: 0, alreadyHere: 3 } });
    expect(projectsNamed("Platform alerts")).toHaveLength(1);
    expect(store().tasks.filter((t) => t.ticketUrl === RULES.url)).toHaveLength(1);
    expect(store().tags.filter((t) => t.name.startsWith("platform-alerts"))).toHaveLength(1);
  });

  it("still runs the next one when the one before it blew up", async () => {
    jira.throwOnce = true;
    const [bad, good] = await Promise.allSettled([
      runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY }),
      runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY }),
    ]);
    expect(bad.status).toBe("rejected");
    expect(good).toMatchObject({ status: "fulfilled", value: { state: "ok", brought: { projects: 1, tasks: 3 } } });
    expect(projectsNamed("Platform alerts")).toHaveLength(1);
  });
});

describe("a tag of yours with the project's name", () => {
  it("is left alone, with the tasks it is on: the project gets a numbered tag of its own", async () => {
    const yours = (await insertTag(userId, "platform-alerts"))!;
    store().tasks.unshift({
      ...store().tasks[0],
      _id: "your-own",
      userId,
      title: "Something of yours",
      tagIds: [yours.id],
      projectId: null,
      lifeArea: "personal",
      ticketUrl: null,
    });

    await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY });
    const [project] = projectsNamed("Platform alerts");
    const mine = store().tasks.find((t) => t._id === "your-own")!;
    expect(mine.projectId).toBeNull();
    expect(mine.lifeArea).toBe("personal");
    expect(tagNamed("platform-alerts")).toMatchObject({ projectId: null });
    expect(tagNamed("platform-alerts2")).toMatchObject({ projectId: project._id, isProjectPrimary: true });
  });
});

describe("a project that lost its tag halfway", () => {
  it("gets one on the next bring-in, and the new tasks wear it", async () => {
    await runPull(userId, { source: SOURCE, level: "coord", off: [RUNBOOK.key], ...EVERY });
    const [project] = projectsNamed("Platform alerts");
    // What a bring-in that stopped between the project and its tag leaves behind.
    const all = store().tags;
    all.splice(all.findIndex((t) => t.projectId === project._id && t.isProjectPrimary), 1);

    await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY });
    const own = store().tags.find((t) => t.projectId === project._id && t.isProjectPrimary);
    expect(own).toBeDefined();
    const runbook = store().tasks.find((t) => t.ticketUrl === RUNBOOK.url)!;
    expect(runbook.tagIds).toContain(own!._id);
  });
});

describe("bringing each epic in as a project", () => {
  it("makes a project per epic with no epic tags", async () => {
    const run = await runPull(userId, { source: SOURCE, level: "epic", off: [], ...EVERY });
    expect(run).toMatchObject({ state: "ok", brought: { projects: 2, tags: 0, tasks: 3 } });
    expect(projectsNamed("Platform alerts")).toHaveLength(0);
    const [queue] = projectsNamed("Queue alerts");
    const [boards] = projectsNamed("Dashboards");
    expect(queue.ticketUrl).toBe(QUEUE.url);
    expect(boards.ticketUrl).toBe(BOARDS.url);
    const rules = tasksOf(queue._id).find((t) => t.ticketUrl === RULES.url)!;
    expect(tagNames(rules.tagIds)).toEqual(["queue-alerts", "work"]);
    // Two projects made in one go each got a tag of their own.
    expect(tagNamed("queue-alerts")).toMatchObject({ projectId: queue._id, isProjectPrimary: true });
    expect(tagNamed("dashboards")).toMatchObject({ projectId: boards._id, isProjectPrimary: true });
  });

  it("gives two epics with the same title a project and a tag each", async () => {
    jira.forest = {
      coords: [],
      epics: [
        { ticket: ticket("VST-1", "Cleanup"), stories: [ticket("VST-11", "One")] },
        { ticket: ticket("VST-2", "Cleanup"), stories: [ticket("VST-12", "Two")] },
      ],
      loose: [],
    };
    await runPull(userId, { source: { kind: "mine" }, level: "epic", off: [], ...EVERY });
    const made = projectsNamed("Cleanup");
    expect(made).toHaveLength(2);
    const own = made.map((p) => store().tags.find((t) => t.projectId === p._id && t.isProjectPrimary)?.name);
    expect(new Set(own).size).toBe(2);
    expect(own.every(Boolean)).toBe(true);
  });
});

describe("names that are taken", () => {
  it("numbers an epic tag another project already owns, and finds it again next time", async () => {
    const other = await insertProject({
      userId,
      title: "Elsewhere",
      description: "",
      color: "oklch(0.6 0.13 155)",
      progress: 0,
      label: "0/0",
      goalId: null,
      tagIds: [],
      lifeArea: "personal",
      createdAt: "2026-07-18",
    });
    await insertTag(userId, "queue-alerts", { projectId: other.id, isProjectPrimary: false });

    await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY });
    const [project] = projectsNamed("Platform alerts");
    const numbered = store().tags.find((t) => t.projectId === project._id && t.name.startsWith("queue-alerts"));
    expect(numbered?.name).toBe("queue-alerts2");
    // The other project's tag is left alone.
    expect(tagNamed("queue-alerts")?.projectId).toBe(other.id);

    const more = tree();
    more.coords[0].epics[0].stories.push(ticket("VST-240", "Page the on-call"));
    jira.forest = more;
    const again = await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY });
    expect(again).toMatchObject({ state: "ok", brought: { tags: 0, tasks: 1 } });
    const added = store().tasks.find((t) => t.ticketUrl === `${BASE}/browse/VST-240`)!;
    expect(added.tagIds).toContain(numbered!._id);
  });
});

describe("tickets with nothing above them", () => {
  it("come in as work tasks outside any project", async () => {
    jira.forest = { coords: [], epics: [], loose: [ticket("OPS-88", "Renew the certificate")] };
    const run = await runPull(userId, { source: { kind: "mine" }, level: "coord", off: [], ...EVERY });
    expect(run).toMatchObject({
      state: "ok",
      brought: { projects: 0, tags: 0, tasks: 1, openProjectId: null },
    });
    const [loose] = tasksOf(null);
    expect(loose.title).toBe("Renew the certificate");
    expect(tagNames(loose.tagIds)).toEqual(["work"]);
    expect(loose.lifeArea).toBe("work");
  });
});

describe("going easy on Jira", () => {
  it("shows what a pull would bring without making anything", async () => {
    const before = { projects: store().projects.length, tasks: store().tasks.length, tags: store().tags.length };
    const preview = await previewPull(userId, SOURCE);
    expect(preview).toMatchObject({ state: "ok", capped: false, have: { tasks: [], projects: [] } });
    expect(preview.state === "ok" && preview.forest.coords[0].ticket.key).toBe("COOR-12");
    expect({ projects: store().projects.length, tasks: store().tasks.length, tags: store().tags.length }).toEqual(before);
  });

  it("reads Jira once for a look, a second look and the bring-in that follows", async () => {
    await previewPull(userId, SOURCE);
    await previewPull(userId, SOURCE);
    await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY });
    expect(jira.reads).toBe(1);
  });

  it("reads again after a bring-in, and says what is here by then", async () => {
    await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY });
    const preview = await previewPull(userId, SOURCE);
    expect(jira.reads).toBe(2);
    expect(preview.state === "ok" && preview.have.projects).toEqual(["COOR-12"]);
    expect(preview.state === "ok" && [...preview.have.tasks].sort()).toEqual(["VST-221", "VST-222", "VST-230"]);
  });

  it("does not show one token's read to another: a changed connection reads again", async () => {
    await previewPull(userId, SOURCE);
    await saveJiraConnectionAction({ address: BASE, token: `${TOKEN}-another-one` });
    await previewPull(userId, SOURCE);
    expect(jira.reads).toBe(2);
  });

  it("keeps one pull's read apart from another's", async () => {
    await previewPull(userId, SOURCE);
    await previewPull(userId, { ...SOURCE, children: false });
    await previewPull(userId, { kind: "mine" });
    expect(jira.reads).toBe(3);
  });
});

describe("when it cannot", () => {
  it("asks Jira nothing and makes nothing with no connection", async () => {
    resetStore();
    forgetPullReads();
    const before = store().tasks.length;
    expect(await previewPull(userId, SOURCE)).toEqual({ state: "no-connection" });
    expect(await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY })).toEqual({ state: "no-connection" });
    expect(jira.reads).toBe(0);
    expect(store().tasks.length).toBe(before);
  });

  it("uses only the asking account's connection and reads", async () => {
    await previewPull(userId, SOURCE);
    expect(await runPull("somebody-else", { source: SOURCE, level: "coord", off: [], ...EVERY })).toEqual({
      state: "no-connection",
    });
    expect(store().projects.filter((p) => p.userId === "somebody-else")).toEqual([]);
  });

  it("passes on why Jira did not answer, and makes nothing", async () => {
    jira.fail = "Jira did not accept that token.";
    const before = store().projects.length;
    expect(await runPull(userId, { source: SOURCE, level: "coord", off: [], ...EVERY })).toEqual({
      state: "failed",
      error: "Jira did not accept that token.",
    });
    expect(store().projects.length).toBe(before);
  });
});

describe("the selectors, applied to the server's own read", () => {
  const mine = (t: PulledTicket): PulledTicket => ({ ...t, mine: true });
  const withMine = (): PullForest => ({
    coords: [
      {
        ticket: COORD,
        epics: [
          { ticket: QUEUE, stories: [mine(RULES), RUNBOOK] },
          { ticket: BOARDS, stories: [LATENCY] },
        ],
      },
    ],
    epics: [],
    loose: [],
  });
  const linked = () => tasksOf(projectsNamed(COORD.title)[0]?._id ?? "none").map((t) => t.ticketUrl).sort();

  it("leaves a finished ticket out when Done is off, and the epic that held nothing else", async () => {
    const run = await runPull(userId, { source: SOURCE, level: "coord", off: [], who: "all", stages: ["todo", "doing"] });
    expect(run).toMatchObject({ state: "ok", brought: { projects: 1, tags: 1, tasks: 2 } });
    expect(linked()).toEqual([RULES.url, RUNBOOK.url].sort());
  });

  it("brings only the owner's tickets when only theirs are wanted", async () => {
    jira.forest = withMine();
    const run = await runPull(userId, { source: SOURCE, level: "coord", off: [], who: "mine", stages: EVERY.stages });
    expect(run).toMatchObject({ state: "ok", brought: { projects: 1, tags: 1, tasks: 1 } });
    expect(linked()).toEqual([RULES.url]);
  });

  it("leaves out a ticket finished after the screen was drawn: the selectors are sent, not the list they made", async () => {
    await previewPull(userId, SOURCE);
    // The preview is gone by the time Bring in is pressed, and Jira has moved on.
    forgetPullReads();
    const moved = tree();
    moved.coords[0].epics[0].stories[1] = { ...RUNBOOK, stage: "done" };
    jira.forest = moved;
    await runPull(userId, { source: SOURCE, level: "coord", off: [], who: "all", stages: ["todo", "doing"] });
    expect(linked()).toEqual([RULES.url]);
  });

  it("takes everybody's when Jira would not say whose token it is, whatever the screen asked", async () => {
    jira.forest = withMine();
    jira.whoKnown = false;
    const run = await runPull(userId, { source: SOURCE, level: "coord", off: [], who: "mine", stages: EVERY.stages });
    expect(run).toMatchObject({ state: "ok", brought: { tasks: 3 } });
  });

  it("does not narrow the owner's own tickets by whose they are: all of them already are", async () => {
    jira.forest = tree();
    const run = await runPull(userId, { source: { kind: "mine" }, level: "coord", off: [], who: "mine", stages: EVERY.stages });
    expect(run).toMatchObject({ state: "ok", brought: { tasks: 3 } });
  });

  it("counts an unticked ticket and a hidden one the same way: neither comes in", async () => {
    const run = await runPull(userId, { source: SOURCE, level: "coord", off: [RUNBOOK.key], who: "all", stages: ["todo", "doing"] });
    expect(run).toMatchObject({ state: "ok", brought: { tasks: 1 } });
    expect(linked()).toEqual([RULES.url]);
  });
});
