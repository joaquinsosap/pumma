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
import { insertTask } from "@/lib/db/memory/tasks";
import { linkProjectToGoal, attachHabitToGoal } from "@/lib/actions/links";
import {
  addTask,
  changeTaskSubtask,
  updateTaskDetail,
} from "@/lib/actions/tasks";
import { toggleEntityTag } from "@/lib/actions/tags";
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
