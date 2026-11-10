// A project's place in the rail: the order made by hand, and what counts as an edit for "last edited".
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { reorderProjectsAction } from "@/lib/actions/projects";
import { projectEditedAt, sortProjects } from "@/lib/collection-sort";
import {
  insertProject,
  listProjects,
  updateProject,
} from "@/lib/db/memory/projects";
import {
  changeSubtask,
  deleteTask,
  deleteTasks,
  insertTask,
  listTasks,
  rewriteSubtasks,
  updateTask,
  updateTasks,
} from "@/lib/db/memory/tasks";
import { getSettings } from "@/lib/db/memory/settings";
import { getCurrentUserId, getStore, resetStore } from "@/lib/store/memory";

const userId = getCurrentUserId();
const LONG_AGO = "2026-01-01T00:00:00.000Z";

const makeProject = (title: string, lifeArea: "personal" | "work" = "personal") =>
  insertProject({
    userId,
    title,
    description: "",
    color: "oklch(0.6 0.13 155)",
    progress: 0,
    label: "0/0",
    goalId: null,
    tagIds: [],
    lifeArea,
    createdAt: "2026-07-18",
  });

const makeTask = (projectId: string | null, title = "a task") =>
  insertTask({
    userId,
    title,
    tagIds: [],
    priority: "med",
    status: "todo",
    due: null,
    projectId,
    goalId: null,
    lifeArea: "personal",
    order: 0,
    createdAt: "2026-07-18",
    completedAt: null,
  });

/** Wind a row's stamp back so the next write is visibly later. */
const age = (kind: "tasks" | "projects", id: string) => {
  const row = getStore()[kind].find((r) => r._id === id)!;
  row.updatedAt = LONG_AGO;
};
const stampOf = (kind: "tasks" | "projects", id: string) =>
  getStore()[kind].find((r) => r._id === id)?.updatedAt ?? null;

const customOrder = async () =>
  sortProjects(await listProjects(userId), "custom").map((p) => p.title);

describe("the hand-made project order", () => {
  beforeEach(() => {
    resetStore();
    getStore().projects = [];
    getStore().tasks = [];
  });

  it("puts a new project first", async () => {
    await makeProject("First made");
    await makeProject("Second made");
    await makeProject("Third made");
    expect(await customOrder()).toEqual([
      "Third made",
      "Second made",
      "First made",
    ]);
  });

  it("saves a drag, switches the rail to Custom and stands it forwards", async () => {
    const a = await makeProject("A");
    const b = await makeProject("B");
    const c = await makeProject("C");

    expect((await reorderProjectsAction([a.id, c.id, b.id])).ok).toBe(true);

    expect(await customOrder()).toEqual(["A", "C", "B"]);
    const settings = await getSettings(userId);
    expect(settings?.projectSort).toBe("custom");
    expect(settings?.sortReversed ?? []).not.toContain("project");
  });

  it("arranging one side of life leaves the other where it was", async () => {
    const work1 = await makeProject("Work 1", "work");
    const home1 = await makeProject("Home 1");
    const work2 = await makeProject("Work 2", "work");
    const home2 = await makeProject("Home 2");
    await reorderProjectsAction([work1.id, home1.id, work2.id, home2.id]);

    // The Personal view only knows its own two.
    await reorderProjectsAction([home2.id, home1.id]);

    expect(await customOrder()).toEqual(["Work 1", "Home 2", "Work 2", "Home 1"]);
  });

  it("ignores an id that is not one of this user's projects", async () => {
    const a = await makeProject("A");
    const b = await makeProject("B");
    expect((await reorderProjectsAction([b.id, "0".repeat(24), a.id])).ok).toBe(
      true,
    );
    expect(await customOrder()).toEqual(["B", "A"]);
  });

  it("does not count as an edit of the projects it moves", async () => {
    const a = await makeProject("A");
    const b = await makeProject("B");
    age("projects", a.id);
    age("projects", b.id);
    await reorderProjectsAction([a.id, b.id]);
    expect(stampOf("projects", a.id)).toBe(LONG_AGO);
    expect(stampOf("projects", b.id)).toBe(LONG_AGO);
  });
});

describe("what counts as editing a project", () => {
  beforeEach(() => {
    resetStore();
    getStore().projects = [];
    getStore().tasks = [];
  });

  const editedAt = async (projectId: string) => {
    const project = (await listProjects(userId)).find((p) => p.id === projectId)!;
    return projectEditedAt(project, await listTasks(userId));
  };

  it("changing the project itself", async () => {
    const p = await makeProject("P");
    age("projects", p.id);
    await updateProject(userId, p.id, { title: "Renamed" });
    expect((await editedAt(p.id)) > LONG_AGO).toBe(true);
  });

  it("adding a task to it", async () => {
    const p = await makeProject("P");
    age("projects", p.id);
    await makeTask(p.id);
    expect((await editedAt(p.id)) > LONG_AGO).toBe(true);
  });

  it.each([
    [
      "editing a task",
      (id: string) => updateTask(userId, id, { title: "new words" }),
    ],
    [
      "editing several at once",
      (id: string) => updateTasks(userId, [{ id, patch: { order: 3 } }]),
    ],
    [
      "adding a subtask",
      (id: string) =>
        changeSubtask(userId, id, { kind: "add", id: "s1", title: "step" }),
    ],
    [
      "rewriting the checklist",
      (id: string) =>
        rewriteSubtasks(userId, id, () => [
          { id: "s1", title: "step", done: false },
        ]),
    ],
  ])("%s in it", async (_name, write) => {
    const p = await makeProject("P");
    const t = await makeTask(p.id);
    age("projects", p.id);
    age("tasks", t.id);

    await write(t.id);

    expect((stampOf("tasks", t.id) ?? "") > LONG_AGO).toBe(true);
    expect((await editedAt(p.id)) > LONG_AGO).toBe(true);
  });

  it("deleting a task from it, which leaves no task to carry the date", async () => {
    const p = await makeProject("P");
    const one = await makeTask(p.id, "one");
    const two = await makeTask(p.id, "two");
    const three = await makeTask(p.id, "three");
    for (const t of [one, two, three]) age("tasks", t.id);

    age("projects", p.id);
    await deleteTask(userId, one.id);
    expect((stampOf("projects", p.id) ?? "") > LONG_AGO).toBe(true);

    age("projects", p.id);
    await deleteTasks(userId, [two.id, three.id]);
    expect((stampOf("projects", p.id) ?? "") > LONG_AGO).toBe(true);
  });

  it("but not a change to a task filed nowhere, or in another project", async () => {
    const p = await makeProject("P");
    const other = await makeProject("Other");
    const loose = await makeTask(null);
    const elsewhere = await makeTask(other.id);
    age("projects", p.id);

    await updateTask(userId, loose.id, { title: "x" });
    await updateTask(userId, elsewhere.id, { title: "y" });
    await deleteTask(userId, loose.id);

    expect(await editedAt(p.id)).toBe(LONG_AGO);
  });
});
