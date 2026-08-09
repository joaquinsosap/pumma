// Deletion must be order-safe: removing any entity unlinks everything that
// pointed at it, so no later edit ever dereferences a dead id. These tests
// exercise the memory repos (same contract as the mongo impls) and assert the
// store holds zero dangling references after every step of every delete order.
import { beforeEach, describe, expect, it } from "vitest";
import { getStore, resetStore, getCurrentUserId } from "@/lib/store/memory";
import { insertGoal, deleteGoal } from "@/lib/db/memory/goals";
import { insertProject, deleteProject } from "@/lib/db/memory/projects";
import { insertHabit, deleteHabit } from "@/lib/db/memory/habits";
import { insertTask, deleteTask } from "@/lib/db/memory/tasks";
import { insertNote } from "@/lib/db/memory/notes";
import { insertTag, deleteTag } from "@/lib/db/memory/tags";
import { toggleHabitEntry } from "@/lib/db/memory/habitEntries";

const userId = getCurrentUserId();

/** Every dangling reference currently in the store, as "kind:fromId->deadId". */
function danglers(): string[] {
  const s = getStore();
  const goalIds = new Set(s.goals.map((g) => g._id));
  const projectIds = new Set(s.projects.map((p) => p._id));
  const habitIds = new Set(s.habits.map((h) => h._id));
  const tagIds = new Set(s.tags.map((t) => t._id));
  const out: string[] = [];
  for (const t of s.tasks) {
    if (t.projectId && !projectIds.has(t.projectId))
      out.push(`task->project:${t._id}->${t.projectId}`);
    if (t.goalId && !goalIds.has(t.goalId))
      out.push(`task->goal:${t._id}->${t.goalId}`);
    for (const tg of t.tagIds)
      if (!tagIds.has(tg)) out.push(`task->tag:${t._id}->${tg}`);
  }
  for (const p of s.projects)
    if (p.goalId && !goalIds.has(p.goalId))
      out.push(`project->goal:${p._id}->${p.goalId}`);
  for (const h of s.habits)
    for (const g of h.goalIds)
      if (!goalIds.has(g)) out.push(`habit->goal:${h._id}->${g}`);
  for (const n of s.notes)
    for (const tg of n.tagIds)
      if (!tagIds.has(tg)) out.push(`note->tag:${n._id}->${tg}`);
  for (const e of s.habitEntries)
    if (!habitIds.has(e.habitId))
      out.push(`habitEntry->habit:${e._id}->${e.habitId}`);
  return out;
}

/** A goal with a project, task, habit (+entry), note, and tag all linked to it. */
async function buildLinkedGraph() {
  const tag = (await insertTag(userId, "deletion-safety-tag"))!;
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
    createdAt: "2026-07-18",
  });
  const project = await insertProject({
    userId,
    title: "P",
    description: "",
    color: "oklch(0.6 0.13 155)",
    progress: 0,
    label: "0/0",
    goalId: goal.id,
    tagIds: [],
    lifeArea: "personal",
    createdAt: "2026-07-18",
  });
  const task = await insertTask({
    userId,
    title: "T",
    tagIds: [tag.id],
    priority: "med",
    status: "todo",
    due: null,
    projectId: project.id,
    goalId: goal.id,
    lifeArea: "personal",
    order: 0,
    createdAt: "2026-07-18",
    completedAt: null,
  });
  const habit = await insertHabit({
    userId,
    name: "H",
    color: "oklch(0.6 0.13 155)",
    frequency: { type: "daily", target: 1 },
    order: 0,
    archived: false,
    goalIds: [goal.id],
    goalTargetStreak: 30,
    tagIds: [],
    lifeArea: "personal",
    createdAt: "2026-07-18",
  });
  await toggleHabitEntry(userId, habit.id, "2026-07-18");
  const note = await insertNote({
    userId,
    title: "N",
    body: "",
    tagIds: [tag.id],
    pinned: false,
    lifeArea: "personal",
    createdAt: "2026-07-18",
    updatedAt: "2026-07-18",
  });
  return { tag, goal, project, task, habit, note };
}

beforeEach(() => {
  resetStore();
});

describe("delete cascades unlink every referencer", () => {
  it("seed data starts with no dangling refs", () => {
    expect(danglers()).toEqual([]);
  });

  it("deleteGoal unlinks projects, tasks and habits", async () => {
    const { goal } = await buildLinkedGraph();
    await deleteGoal(userId, goal.id);
    expect(danglers()).toEqual([]);
    const s = getStore();
    expect(s.projects.some((p) => p.goalId === goal.id)).toBe(false);
    expect(s.tasks.some((t) => t.goalId === goal.id)).toBe(false);
    expect(s.habits.some((h) => h.goalIds.includes(goal.id))).toBe(false);
  });

  it("deleteProject unlinks its tasks", async () => {
    const { project, task } = await buildLinkedGraph();
    await deleteProject(userId, project.id);
    expect(danglers()).toEqual([]);
    const stored = getStore().tasks.find((t) => t._id === task.id);
    expect(stored?.projectId).toBeNull();
  });

  it("deleteProject with deleteTasks removes the tasks too", async () => {
    const { project, task } = await buildLinkedGraph();
    await deleteProject(userId, project.id, { deleteTasks: true });
    expect(danglers()).toEqual([]);
    expect(getStore().tasks.some((t) => t._id === task.id)).toBe(false);
    // Only the project's own tasks go — everything else stays.
    expect(getStore().tasks.length).toBeGreaterThan(0);
  });

  it("deleteHabit removes its entries", async () => {
    const { habit } = await buildLinkedGraph();
    await deleteHabit(userId, habit.id);
    expect(danglers()).toEqual([]);
    expect(getStore().habitEntries.some((e) => e.habitId === habit.id)).toBe(
      false,
    );
  });

  it("deleteTag detaches from tasks and notes", async () => {
    const { tag } = await buildLinkedGraph();
    await deleteTag(userId, tag.id);
    expect(danglers()).toEqual([]);
    const s = getStore();
    expect(s.tasks.some((t) => t.tagIds.includes(tag.id))).toBe(false);
    expect(s.notes.some((n) => n.tagIds.includes(tag.id))).toBe(false);
  });
});

describe("deletion is safe in any order", () => {
  type Step = [
    name: string,
    run: (g: Awaited<ReturnType<typeof buildLinkedGraph>>) => Promise<unknown>,
  ];
  const steps: Step[] = [
    ["goal", (g) => deleteGoal(userId, g.goal.id)],
    ["project", (g) => deleteProject(userId, g.project.id)],
    ["task", (g) => deleteTask(userId, g.task.id)],
    ["habit", (g) => deleteHabit(userId, g.habit.id)],
    ["tag", (g) => deleteTag(userId, g.tag.id)],
  ];

  function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items];
    return items.flatMap((item, i) =>
      permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(
        (rest) => [item, ...rest],
      ),
    );
  }

  it("no dangling refs after any step of all 120 delete orders", async () => {
    for (const order of permutations(steps)) {
      resetStore();
      const graph = await buildLinkedGraph();
      for (const [name, run] of order) {
        await run(graph);
        const dead = danglers();
        expect(
          dead,
          `order [${order.map(([n]) => n).join(" → ")}] after deleting ${name}`,
        ).toEqual([]);
      }
    }
  });
});
