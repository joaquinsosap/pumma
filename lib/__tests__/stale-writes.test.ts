// Stale clients can hold ids of entities deleted since their last render and
// send them back through server actions. These tests call the real actions in
// memory mode and assert dead links are rejected (explicit link actions) or
// silently dropped (implicit capture/update paths) — never persisted.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { revalidatePath } from "next/cache";
import { getStore, resetStore, getCurrentUserId } from "@/lib/store/memory";
import { insertGoal, deleteGoal } from "@/lib/db/memory/goals";
import { insertProject, deleteProject } from "@/lib/db/memory/projects";
import { insertTag, deleteTag } from "@/lib/db/memory/tags";
import { insertHabit } from "@/lib/db/memory/habits";
import { markHabitEntry } from "@/lib/db/memory/habitEntries";
import { insertNote } from "@/lib/db/memory/notes";
import { insertTask } from "@/lib/db/memory/tasks";
import { linkProjectToGoal, attachHabitToGoal } from "@/lib/actions/links";
import {
  addTask,
  bulkUpdateTasks,
  changeTaskSubtask,
  moveTaskStatus,
  toggleTask,
  updateTaskDetail,
} from "@/lib/actions/tasks";
import { toggleEntityTag } from "@/lib/actions/tags";
import { archiveHabit, toggleHabitPeriod } from "@/lib/actions/habits";
import { toggleNotePin } from "@/lib/actions/notes";
import { startTaskTimer, stopTaskTimer } from "@/lib/actions/task-timer";
import { MAX_SUBTASKS } from "@/lib/subtask-changes";
import type { Subtask } from "@/lib/schemas";

const userId = getCurrentUserId();

async function makeGoal() {
  return insertGoal({
    userId,
    title: "Stale goal",
    category: "personal",
    metricLabel: "",
    progress: 0,
    targetDate: null,
    tagIds: [],
    lifeArea: "personal",
    order: 0,
    createdAt: "2026-07-18",
  });
}

async function makeProject() {
  return insertProject({
    userId,
    title: "Stale project",
    description: "",
    color: "oklch(0.6 0.13 155)",
    progress: 0,
    label: "0/0",
    goalId: null,
    tagIds: [],
    lifeArea: "personal",
    createdAt: "2026-07-18",
  });
}

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
  resetStore();
});

describe("stale writes cannot recreate dangling references", () => {
  it("linkProjectToGoal rejects a deleted goal id", async () => {
    const goal = await makeGoal();
    const project = await makeProject();
    await deleteGoal(userId, goal.id);

    const res = await linkProjectToGoal(project.id, goal.id);
    expect(res).toEqual({ ok: false, error: "Goal not found" });
    const stored = getStore().projects.find((p) => p._id === project.id);
    expect(stored?.goalId).toBeNull();
  });

  it("attachHabitToGoal rejects a deleted goal id", async () => {
    const goal = await makeGoal();
    const habit = getStore().habits[0];
    await deleteGoal(userId, goal.id);

    const res = await attachHabitToGoal(habit._id, goal.id);
    expect(res).toEqual({ ok: false, error: "Goal not found" });
    expect(
      getStore().habits.find((h) => h._id === habit._id)?.goalIds,
    ).not.toContain(goal.id);
  });

  it("addTask drops a deleted project id instead of linking it", async () => {
    const project = await makeProject();
    await deleteProject(userId, project.id);

    const res = await addTask({
      text: "orphan capture",
      projectId: project.id,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data?.projectId).toBeNull();
  });

  it("updateTaskDetail drops deleted tag ids from the patch", async () => {
    const tag = (await insertTag(userId, "stale-tag"))!;
    const task = getStore().tasks[0];
    await deleteTag(userId, tag.id);

    const res = await updateTaskDetail({ id: task._id, tagIds: [tag.id] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data?.tagIds).not.toContain(tag.id);
  });

  it("toggleEntityTag rejects a deleted tag id", async () => {
    const tag = (await insertTag(userId, "stale-toggle-tag"))!;
    const task = getStore().tasks[0];
    await deleteTag(userId, tag.id);

    const res = await toggleEntityTag("task", task._id, tag.id);
    expect(res.ok).toBe(false);
    expect(
      getStore().tasks.find((t) => t._id === task._id)?.tagIds,
    ).not.toContain(tag.id);
  });
});

describe("a stale task panel", () => {
  const rows = (n: number, done = false): Subtask[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      title: `Row ${i}`,
      done,
    }));

  const seed = (subtasks: Subtask[], owner = userId) =>
    insertTask({
      userId: owner,
      title: "Greenhouse",
      description: "",
      subtasks,
      tagIds: [],
      priority: "med",
      status: "todo",
      due: null,
      projectId: null,
      goalId: null,
      lifeArea: "personal",
      order: 0,
      createdAt: "2026-10-01",
      completedAt: null,
    });

  const stored = (id: string) =>
    getStore().tasks.find((t) => t._id === id)!.subtasks;

  it("leaves 18 of 18 when a chat ticked them all and it ticks one", async () => {
    const { id } = await seed(rows(18, true));
    const res = await changeTaskSubtask({
      id,
      change: { kind: "setDone", id: "s0", done: true },
    });
    expect(res.ok).toBe(true);
    expect(stored(id)).toEqual(rows(18, true));
  });

  it("keeps a row added and a tick made since it opened", async () => {
    const { id } = await seed([
      { id: "seen", title: "Seen", done: true },
      { id: "other", title: "Other", done: false },
      { id: "later", title: "Added since", done: false },
    ]);
    await changeTaskSubtask({
      id,
      change: { kind: "setDone", id: "other", done: true },
    });
    expect(stored(id)).toEqual([
      { id: "seen", title: "Seen", done: true },
      { id: "other", title: "Other", done: true },
      { id: "later", title: "Added since", done: false },
    ]);
  });

  it("changes only the row it names when renaming or removing", async () => {
    const { id } = await seed(rows(3, true));
    await changeTaskSubtask({
      id,
      change: { kind: "rename", id: "s1", title: "  Renamed  " },
    });
    expect(stored(id)[1]).toEqual({ id: "s1", title: "Renamed", done: true });
    await changeTaskSubtask({ id, change: { kind: "remove", id: "s0" } });
    expect(stored(id).map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("gets a quiet ok when the row is already gone, and writes nothing", async () => {
    const { id } = await seed(rows(2));
    const before = stored(id);
    for (const change of [
      { kind: "setDone", id: "gone", done: true },
      { kind: "rename", id: "gone", title: "x" },
    ] as const) {
      expect(await changeTaskSubtask({ id, change })).toEqual({
        ok: true,
        data: before,
      });
    }
    expect(stored(id)).toBe(before);
    // The row is still on that panel's screen, and this is what clears it.
    expect(revalidatePath).toHaveBeenCalledTimes(2);
  });

  it("answers with what is now stored, and refreshes the page", async () => {
    const { id } = await seed(rows(2));
    const res = await changeTaskSubtask({
      id,
      change: { kind: "setDone", id: "s1", done: true },
    });
    expect(res).toEqual({
      ok: true,
      data: [
        { id: "s0", title: "Row 0", done: false },
        { id: "s1", title: "Row 1", done: true },
      ],
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("makes one row when an add is sent twice", async () => {
    const { id } = await seed([]);
    const change = { kind: "add", id: "once", title: "Plant" } as const;
    const row = { id: "once", title: "Plant", done: false };
    for (let i = 0; i < 2; i++) {
      expect(await changeTaskSubtask({ id, change })).toEqual({
        ok: true,
        data: [row],
      });
    }
    expect(stored(id)).toEqual([row]);
  });

  it("says so when a list is full, and doesn't refresh", async () => {
    const { id } = await seed(rows(MAX_SUBTASKS));
    const res = await changeTaskSubtask({
      id,
      change: { kind: "add", id: "one-more", title: "x" },
    });
    expect(res).toEqual({ ok: false, error: "A task can hold 200 subtasks." });
    expect(stored(id)).toHaveLength(MAX_SUBTASKS);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("doesn't call a list full when the change is not an add", async () => {
    const { id } = await seed(rows(MAX_SUBTASKS));
    const res = await changeTaskSubtask({
      id,
      change: { kind: "setDone", id: "gone", done: true },
    });
    expect(res.ok).toBe(true);
  });

  it("answers ok when an add landed as the last row and is sent again", async () => {
    const { id } = await seed(rows(MAX_SUBTASKS - 1));
    const change = { kind: "add", id: "last", title: "x" } as const;
    expect((await changeTaskSubtask({ id, change })).ok).toBe(true);
    expect((await changeTaskSubtask({ id, change })).ok).toBe(true);
    expect(stored(id)).toHaveLength(MAX_SUBTASKS);
  });

  it("can't reach another account's task", async () => {
    const { id } = await seed(rows(1), "someone-else");
    const before = stored(id);
    for (const change of [
      { kind: "setDone", id: "s0", done: true },
      { kind: "remove", id: "s0" },
      { kind: "add", id: "new", title: "x" },
    ] as const) {
      expect(await changeTaskSubtask({ id, change })).toEqual({
        ok: false,
        error: "Not found",
      });
    }
    expect(stored(id)).toBe(before);
  });

  it("refuses bad input and writes nothing", async () => {
    const { id } = await seed(rows(1));
    const before = stored(id);
    const bad: Parameters<typeof changeTaskSubtask>[0][] = [
      { id: "not-an-id", change: { kind: "remove", id: "s0" } },
      { id, change: { kind: "remove", id: "" } },
      { id, change: { kind: "remove", id: "x".repeat(65) } },
      { id, change: { kind: "add", id: "n", title: "   " } },
      { id, change: { kind: "rename", id: "s0", title: "   " } },
      { id, change: { kind: "rename", id: "s0", title: "x".repeat(501) } },
      { id, change: { kind: "setDone", id: "s0", done: "yes" as never } },
      { id, change: { kind: "flip", id: "s0" } as never },
    ];
    for (const input of bad) {
      expect(await changeTaskSubtask(input)).toEqual({
        ok: false,
        error: "Invalid input",
      });
    }
    expect(stored(id)).toBe(before);
  });

  it("can no longer send a whole list through updateTaskDetail", async () => {
    const { id } = await seed(rows(3, true));
    const before = stored(id);
    const res = await updateTaskDetail({
      id,
      subtasks: [{ id: "s0", title: "Row 0", done: false }],
    } as never);
    expect(res).toEqual({ ok: false, error: "Nothing to update" });
    expect(stored(id)).toBe(before);
  });
});

describe("a due date set in an old panel", () => {
  const seedDue = (due: string | null) =>
    insertTask({
      userId,
      title: "Greenhouse",
      description: "",
      subtasks: [],
      tagIds: [],
      priority: "med",
      status: "todo",
      due,
      projectId: null,
      goalId: null,
      lifeArea: "personal",
      order: 0,
      createdAt: "2026-10-01",
      completedAt: null,
    });
  const due = (id: string) => getStore().tasks.find((t) => t._id === id)!.due;

  it("keeps the date stored now when it sets a time", async () => {
    const { id } = await seedDue("2026-11-05");
    await updateTaskDetail({ id, dueTime: "09:30" });
    expect(due(id)).toBe("2026-11-05T09:30");
  });

  it("keeps the time stored now when it picks a date", async () => {
    const { id } = await seedDue("2026-11-05T09:30");
    await updateTaskDetail({ id, dueDate: "2026-12-01" });
    expect(due(id)).toBe("2026-12-01T09:30");
  });

  it("clears only the time", async () => {
    const { id } = await seedDue("2026-11-05T09:30");
    await updateTaskDetail({ id, dueTime: null });
    expect(due(id)).toBe("2026-11-05");
  });

  it("applies a date and a time sent together", async () => {
    const { id } = await seedDue("2026-11-05T09:30");
    await updateTaskDetail({ id, dueDate: "2026-12-01", dueTime: "18:00" });
    expect(due(id)).toBe("2026-12-01T18:00");
  });

  it("says so when the date it wanted a time on is gone", async () => {
    const { id } = await seedDue(null);
    expect(await updateTaskDetail({ id, dueTime: "09:30" })).toEqual({
      ok: false,
      error: "Set a due date first",
    });
    expect(due(id)).toBeNull();
  });

  it("refuses a time or date that isn't one", async () => {
    const { id } = await seedDue("2026-11-05");
    for (const bad of [
      { dueTime: "9am" },
      { dueTime: "09:30; drop" },
      { dueDate: "tomorrow" },
    ]) {
      expect(await updateTaskDetail({ id, ...bad })).toEqual({
        ok: false,
        error: "Invalid input",
      });
    }
    expect(due(id)).toBe("2026-11-05");
  });
});

describe("a click on an old screen", () => {
  const seedTask = (
    over: { status?: "todo" | "done"; completedAt?: string | null; tagIds?: string[] } = {},
  ) =>
    insertTask({
      userId,
      title: "Greenhouse",
      description: "",
      subtasks: [],
      tagIds: over.tagIds ?? [],
      priority: "med",
      status: over.status ?? "todo",
      due: null,
      projectId: null,
      goalId: null,
      lifeArea: "personal",
      order: 0,
      createdAt: "2026-10-01",
      completedAt: over.completedAt ?? null,
    });
  const task = (id: string) => getStore().tasks.find((t) => t._id === id)!;

  // Every one sends the real state back, or that old screen stays old.
  const expectFreshPage = () => expect(revalidatePath).toHaveBeenCalled();

  describe("on the task checkbox", () => {
    it("keeps a task closed, with its date, when a chat got there first", async () => {
      const { id } = await seedTask({ status: "done", completedAt: "2026-10-02" });
      const before = task(id);
      expect((await toggleTask(id, true)).ok).toBe(true);
      expect(task(id)).toBe(before);
      expectFreshPage();
    });

    it("keeps a task open when the click meant reopen", async () => {
      const { id } = await seedTask();
      const before = task(id);
      expect((await toggleTask(id, false)).ok).toBe(true);
      expect(task(id)).toBe(before);
      expectFreshPage();
    });

    it("moves the goal above it when that changes something", async () => {
      const goal = await insertGoal({
        userId,
        title: "G",
        category: "personal",
        metricLabel: "",
        progress: 0,
        targetDate: null,
        tagIds: [],
        lifeArea: "personal",
        order: 0,
        createdAt: "2026-10-01",
      });
      const project = await insertProject({
        userId,
        title: "P",
        description: "",
        color: "oklch(0.6 0.13 155)",
        progress: 0,
        label: "0/1",
        goalId: goal.id,
        tagIds: [],
        lifeArea: "personal",
        createdAt: "2026-10-01",
      });
      const { id } = await insertTask({
        userId,
        title: "Greenhouse",
        description: "",
        subtasks: [],
        tagIds: [],
        priority: "med",
        status: "todo",
        due: null,
        projectId: project.id,
        goalId: null,
        lifeArea: "personal",
        order: 0,
        createdAt: "2026-10-01",
        completedAt: null,
      });
      await toggleTask(id, true);
      expect(getStore().goals.find((g) => g._id === goal.id)!.progress).toBe(100);
    });

    it("still closes and reopens when that changes something", async () => {
      const { id } = await seedTask();
      await toggleTask(id, true);
      expect(task(id).status).toBe("done");
      expect(task(id).completedAt).not.toBeNull();
      await toggleTask(id, false);
      expect(task(id).status).toBe("todo");
      expect(task(id).completedAt).toBeNull();
    });

    it("still flips for a caller that doesn't say which way", async () => {
      const { id } = await seedTask();
      await toggleTask(id);
      expect(task(id).status).toBe("done");
      await toggleTask(id);
      expect(task(id).status).toBe("todo");
    });

    it("refuses anything but a yes or no", async () => {
      const { id } = await seedTask();
      const before = task(id);
      expect(await toggleTask(id, "yes" as never)).toEqual({
        ok: false,
        error: "Invalid input",
      });
      expect(task(id)).toBe(before);
    });
  });

  describe("on a status chip", () => {
    it("keeps the date on a task a chat already closed", async () => {
      const { id } = await seedTask({ status: "done", completedAt: "2026-10-02" });
      const before = task(id);
      expect((await moveTaskStatus(id, "done")).ok).toBe(true);
      expect(task(id)).toBe(before);
      expectFreshPage();
    });

    it("still repairs the goal above it", async () => {
      const goal = await insertGoal({
        userId,
        title: "G",
        category: "personal",
        metricLabel: "",
        progress: 7,
        targetDate: null,
        tagIds: [],
        lifeArea: "personal",
        order: 0,
        createdAt: "2026-10-01",
      });
      const project = await insertProject({
        userId,
        title: "P",
        description: "",
        color: "oklch(0.6 0.13 155)",
        progress: 0,
        label: "0/1",
        goalId: goal.id,
        tagIds: [],
        lifeArea: "personal",
        createdAt: "2026-10-01",
      });
      const { id } = await insertTask({
        userId,
        title: "Greenhouse",
        description: "",
        subtasks: [],
        tagIds: [],
        priority: "med",
        status: "done",
        due: null,
        projectId: project.id,
        goalId: null,
        lifeArea: "personal",
        order: 0,
        createdAt: "2026-10-01",
        completedAt: "2026-10-02",
      });
      await moveTaskStatus(id, "done");
      expect(getStore().goals.find((g) => g._id === goal.id)!.progress).toBe(100);
    });

    it("still stamps and clears the date when that changes something", async () => {
      const { id } = await seedTask();
      await moveTaskStatus(id, "done");
      expect(task(id).completedAt).not.toBeNull();
      await moveTaskStatus(id, "doing");
      expect(task(id).status).toBe("doing");
      expect(task(id).completedAt).toBeNull();
    });
  });

  describe("on a bulk edit", () => {
    it("keeps the date on tasks that already have that status", async () => {
      const closed = await seedTask({ status: "done", completedAt: "2026-10-02" });
      const open = await seedTask();
      const before = task(closed.id);
      await bulkUpdateTasks({ ids: [closed.id, open.id], status: "done" });
      expect(task(closed.id)).toBe(before);
      expect(task(open.id).status).toBe("done");
    });
  });

  describe("on a tag chip of a task filed without its project's tag", () => {
    const filedWithoutTag = async () => {
      const project = await insertProject({
        userId,
        title: "Filed",
        description: "",
        color: "oklch(0.6 0.13 155)",
        progress: 0,
        label: "0/1",
        goalId: null,
        tagIds: [],
        lifeArea: "personal",
        createdAt: "2026-10-01",
      });
      const { id } = await insertTask({
        userId,
        title: "Greenhouse",
        description: "",
        subtasks: [],
        tagIds: [],
        priority: "med",
        status: "todo",
        due: null,
        projectId: project.id,
        goalId: null,
        lifeArea: "personal",
        order: 0,
        createdAt: "2026-10-01",
        completedAt: null,
      });
      const tag = (await insertTag(userId, "plain-tag"))!;
      return { id, projectId: project.id, tag };
    };

    it("stays in its project when an unrelated tag goes on", async () => {
      const { id, projectId, tag } = await filedWithoutTag();
      await toggleEntityTag("task", id, tag.id, true);
      expect(task(id).projectId).toBe(projectId);
      expect(task(id).tagIds).toContain(tag.id);
    });

    it("stays in its project through a bulk tag edit too", async () => {
      const { id, projectId, tag } = await filedWithoutTag();
      await bulkUpdateTasks({ ids: [id], addTagIds: [tag.id] });
      expect(task(id).projectId).toBe(projectId);
      expect(task(id).tagIds).toContain(tag.id);
    });

    it("still leaves the project when its own project tag comes off", async () => {
      const { id, projectId } = await filedWithoutTag();
      const own = (await insertTag(userId, "filed-tag", {
        projectId,
        isProjectPrimary: true,
      }))!;
      await toggleEntityTag("task", id, own.id, true);
      expect(task(id).projectId).toBe(projectId);
      await toggleEntityTag("task", id, own.id, false);
      expect(task(id).projectId).toBeNull();
    });
  });

  describe("on a tag chip", () => {
    const tagged = async () => (await insertTag(userId, "stale-tag"))!;

    it("keeps a tag that a chat already put on", async () => {
      const tag = await tagged();
      const { id } = await seedTask({ tagIds: [tag.id] });
      const before = task(id);
      expect(await toggleEntityTag("task", id, tag.id, true)).toEqual({
        ok: true,
        data: { applied: true },
      });
      expect(task(id)).toBe(before);
      expectFreshPage();
    });

    it("keeps a tag off when a chat already took it off", async () => {
      const tag = await tagged();
      const { id } = await seedTask();
      const before = task(id);
      expect(await toggleEntityTag("task", id, tag.id, false)).toEqual({
        ok: true,
        data: { applied: false },
      });
      expect(task(id)).toBe(before);
    });

    it("still adds and removes when that changes something", async () => {
      const tag = await tagged();
      const { id } = await seedTask();
      await toggleEntityTag("task", id, tag.id, true);
      expect(task(id).tagIds).toContain(tag.id);
      await toggleEntityTag("task", id, tag.id, false);
      expect(task(id).tagIds).not.toContain(tag.id);
    });

    it("holds for the other things a tag goes on", async () => {
      const tag = await tagged();
      const goal = await makeGoal();
      const project = await makeProject();
      const note = await insertNote({
        userId,
        title: "N",
        body: "",
        tagIds: [],
        pinned: false,
        lifeArea: "personal",
        createdAt: "2026-07-18",
        updatedAt: "2026-07-18",
      });
      const habit = getStore().habits[0];
      for (const [entity, id] of [
        ["goal", goal.id],
        ["project", project.id],
        ["note", note.id],
        ["habit", habit._id],
      ] as const) {
        await toggleEntityTag(entity, id, tag.id, true);
        const res = await toggleEntityTag(entity, id, tag.id, true);
        expect(res, entity).toEqual({ ok: true, data: { applied: true } });
        const rows = {
          goal: getStore().goals,
          project: getStore().projects,
          note: getStore().notes,
          habit: getStore().habits,
        }[entity] as { _id: string; tagIds: string[] }[];
        expect(
          rows.find((r) => r._id === id)!.tagIds.filter((t) => t === tag.id),
          entity,
        ).toEqual([tag.id]);
      }
    });

    it("refuses anything but a yes or no", async () => {
      const tag = await tagged();
      const { id } = await seedTask();
      expect(await toggleEntityTag("task", id, tag.id, "yes" as never)).toEqual({
        ok: false,
        error: "Invalid input",
      });
    });
  });

  describe("on a note's star", () => {
    const seedNote = (pinned: boolean) =>
      insertNote({
        userId,
        title: "N",
        body: "",
        tagIds: [],
        pinned,
        lifeArea: "personal",
        createdAt: "2026-07-18",
        updatedAt: "2026-07-18",
      });
    const note = (id: string) => getStore().notes.find((n) => n._id === id)!;

    it("keeps it pinned when it already is", async () => {
      const { id } = await seedNote(true);
      const before = note(id);
      expect((await toggleNotePin(id, true)).ok).toBe(true);
      expect(note(id)).toBe(before);
      expectFreshPage();
    });

    it("changes it when that changes something, and still flips when not told", async () => {
      const { id } = await seedNote(false);
      await toggleNotePin(id, true);
      expect(note(id).pinned).toBe(true);
      await toggleNotePin(id);
      expect(note(id).pinned).toBe(false);
    });

    it("refuses anything but a yes or no", async () => {
      const { id } = await seedNote(false);
      expect(await toggleNotePin(id, "yes" as never)).toEqual({
        ok: false,
        error: "Invalid input",
      });
    });
  });

  describe("on a habit box", () => {
    const seedHabit = () =>
      insertHabit({
        userId,
        name: "H",
        color: "oklch(0.6 0.13 155)",
        frequency: { type: "daily", target: 1 },
        order: 0,
        archived: false,
        goalIds: [],
        goalTargetStreak: 30,
        tagIds: [],
        lifeArea: "personal",
        createdAt: "2026-07-18",
      });
    const day = { start: "2026-10-31", end: "2026-10-31", markDate: "2026-10-31" };
    const entries = (habitId: string) =>
      getStore().habitEntries.filter((e) => e.habitId === habitId);

    it("keeps a box ticked when it already is", async () => {
      const { id } = await seedHabit();
      await markHabitEntry(userId, id, day.markDate);
      const res = await toggleHabitPeriod({ habitId: id, ...day, done: true });
      expect(res).toEqual({ ok: true, data: { done: true } });
      expect(entries(id)).toHaveLength(1);
      expectFreshPage();
    });

    it("keeps a box empty when it already is", async () => {
      const { id } = await seedHabit();
      const res = await toggleHabitPeriod({ habitId: id, ...day, done: false });
      expect(res).toEqual({ ok: true, data: { done: false } });
      expect(entries(id)).toHaveLength(0);
    });

    it("still ticks, clears and flips when that changes something", async () => {
      const { id } = await seedHabit();
      await toggleHabitPeriod({ habitId: id, ...day, done: true });
      expect(entries(id)).toHaveLength(1);
      await toggleHabitPeriod({ habitId: id, ...day, done: false });
      expect(entries(id)).toHaveLength(0);
      await toggleHabitPeriod({ habitId: id, ...day });
      expect(entries(id)).toHaveLength(1);
    });
  });

  describe("on a habit's on and off switch", () => {
    const seedHabit = (archived: boolean) =>
      insertHabit({
        userId,
        name: "Read",
        color: "oklch(0.6 0.13 155)",
        frequency: { type: "daily", target: 1 },
        order: 0,
        archived,
        goalIds: [],
        goalTargetStreak: null,
        tagIds: [],
        lifeArea: "personal",
        createdAt: "2026-10-01",
      });
    const habit = (id: string) => getStore().habits.find((h) => h._id === id)!;

    it("leaves a habit off when another tab already turned it off", async () => {
      const { id } = await seedHabit(true);
      const before = habit(id);
      expect((await archiveHabit(id, true)).ok).toBe(true);
      expect(habit(id)).toBe(before);
      expectFreshPage();
    });

    it("leaves a habit on when the click meant on", async () => {
      const { id } = await seedHabit(false);
      const before = habit(id);
      expect((await archiveHabit(id, false)).ok).toBe(true);
      expect(habit(id)).toBe(before);
    });

    it("still switches when that changes something, and an old tab's call still flips", async () => {
      const { id } = await seedHabit(false);
      await archiveHabit(id, true);
      expect(habit(id).archived).toBe(true);
      await archiveHabit(id);
      expect(habit(id).archived).toBe(false);
    });

    it("refuses something that isn't a yes or no", async () => {
      const { id } = await seedHabit(false);
      expect(await archiveHabit(id, "yes" as unknown as boolean)).toEqual({
        ok: false,
        error: "Invalid input",
      });
    });
  });

  describe("on the timer button", () => {
    it("leaves a running timer running, and a stopped one stopped", async () => {
      const { id } = await seedTask();
      await startTaskTimer(id);
      const running = task(id).timerStartedAt;
      expect(running).not.toBeNull();
      vi.mocked(revalidatePath).mockClear();
      expect((await startTaskTimer(id)).ok).toBe(true);
      expect(task(id).timerStartedAt).toBe(running);
      expectFreshPage();

      await stopTaskTimer(id);
      const stopped = task(id);
      vi.mocked(revalidatePath).mockClear();
      expect((await stopTaskTimer(id)).ok).toBe(true);
      expect(task(id)).toBe(stopped);
      expectFreshPage();
    });
  });
});
