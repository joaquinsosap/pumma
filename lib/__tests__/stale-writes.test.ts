// Stale clients can hold ids of entities deleted since their last render and
// send them back through server actions. These tests call the real actions in
// memory mode and assert dead links are rejected (explicit link actions) or
// silently dropped (implicit capture/update paths) — never persisted.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { getStore, resetStore, getCurrentUserId } from "@/lib/store/memory";
import { insertGoal, deleteGoal } from "@/lib/db/memory/goals";
import { insertProject, deleteProject } from "@/lib/db/memory/projects";
import { insertTag, deleteTag } from "@/lib/db/memory/tags";
import { linkProjectToGoal, attachHabitToGoal } from "@/lib/actions/links";
import { addTask, updateTaskDetail } from "@/lib/actions/tasks";
import { toggleEntityTag } from "@/lib/actions/tags";

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
