// Goal progress is the number on every goal card and the "roll up" the app
// promises: projects and habits underneath a goal become one percentage.
// These pin the arithmetic — averages of averages, the archived exclusion,
// and the streak-to-target conversion with its cap and floor.
import { describe, expect, it } from "vitest";
import { computeGoalProgress, habitStreakProgress } from "@/lib/goal-sync";
import type { Habit, HabitEntry, Project, Task } from "@/lib/schemas";

// Complete literals spread with overrides, matching the house style in
// task-filters.test.ts: a partial cast keeps compiling until someone adds a
// required field, and then fails everywhere at once for no real reason.
const project = (id: string, goalId: string | null): Project =>
  ({
    id,
    userId: "u",
    title: id,
    description: "",
    color: "#000",
    progress: 0,
    label: "",
    goalId,
    tagIds: [],
    lifeArea: "personal",
    createdAt: "2026-01-01",
  }) as Project;

let seq = 0;
const task = (projectId: string, status: "todo" | "done"): Task =>
  ({
    id: `t${seq++}`,
    userId: "u",
    title: "t",
    description: "",
    subtasks: [],
    tagIds: [],
    priority: "med",
    status,
    due: null,
    projectId,
    goalId: null,
    lifeArea: "personal",
    order: 0,
    createdAt: "2026-01-01",
    completedAt: null,
    timeSpentSec: 0,
    timerStartedAt: null,
  }) as Task;

const habit = (
  id: string,
  goalIds: string[],
  over: Partial<Habit> = {},
): Habit =>
  ({
    id,
    userId: "u",
    name: id,
    color: "#000",
    frequency: { type: "daily", target: 1 },
    order: 0,
    archived: false,
    goalIds,
    goalTargetStreak: null,
    tagIds: [],
    lifeArea: "personal",
    createdAt: "2026-01-01",
    ...over,
  }) as Habit;

/** N consecutive days of entries ending today, so streakOf sees a live run. */
const run = (habitId: string, days: number): HabitEntry[] =>
  Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return {
      id: `${habitId}-${i}`,
      habitId,
      date: d.toISOString().slice(0, 10),
    } as HabitEntry;
  });

describe("computeGoalProgress", () => {
  it("is null with nothing linked — no links means no number, not zero", () => {
    expect(computeGoalProgress("g", [], [], [], [])).toBeNull();
  });

  it("averages linked projects by their task completion", () => {
    const projects = [project("p1", "g"), project("p2", "g")];
    const tasks = [
      task("p1", "done"),
      task("p1", "done"), // p1: 100%
      task("p2", "done"),
      task("p2", "todo"), // p2: 50%
    ];
    expect(computeGoalProgress("g", projects, [], [], tasks)).toBe(75);
  });

  it("ignores archived habits entirely", () => {
    const habits = [
      habit("h1", ["g"], { goalTargetStreak: 10 }),
      habit("h2", ["g"], { archived: true, goalTargetStreak: 10 }),
    ];
    // h1 has a 5-day streak toward 10 → 50. h2 (archived, no entries) would
    // drag the average to 25 if it were counted.
    expect(computeGoalProgress("g", [], habits, run("h1", 5), [])).toBe(50);
  });

  it("weighs the project half and the habit half equally", () => {
    const projects = [project("p1", "g")];
    const tasks = [task("p1", "done")]; // projects half: 100
    const habits = [habit("h1", ["g"], { goalTargetStreak: 10 })];
    // habits half: 5/10 → 50. (100 + 50) / 2 = 75.
    expect(
      computeGoalProgress("g", projects, habits, run("h1", 5), tasks),
    ).toBe(75);
  });
});

describe("habitStreakProgress", () => {
  it("caps at 100 once the streak passes the target", () => {
    const { progress } = habitStreakProgress("h", run("h", 15), 10);
    expect(progress).toBe(100);
  });

  it("survives a zero target by flooring it to one", () => {
    const { target, progress } = habitStreakProgress("h", run("h", 3), 0);
    // 0 falls back to the default target rather than dividing by zero.
    expect(target).toBeGreaterThan(0);
    expect(Number.isFinite(progress)).toBe(true);
  });
});
