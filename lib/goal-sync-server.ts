// Server-only goal sync: reads/writes the database to recompute goal progress
// from linked projects + habits. Kept separate from lib/goal-sync.ts (pure) so
// Client Components can import the pure helpers without pulling in the data layer.
import "server-only";
import { listGoals, updateGoal } from "@/lib/db/goals";
import { listProjects } from "@/lib/db/projects";
import { listHabits } from "@/lib/db/habits";
import { listHabitEntries } from "@/lib/db/habitEntries";
import { listTasks } from "@/lib/db/tasks";
import { computeGoalProgress } from "@/lib/goal-sync";
import type { Project, Habit, HabitEntry, Task } from "@/lib/schemas";

/** The four collections computeGoalProgress reads from, fetched together. */
export type GoalSyncData = {
  projects: Project[];
  habits: Habit[];
  habitEntries: HabitEntry[];
  tasks: Task[];
};

async function loadGoalSyncData(userId: string): Promise<GoalSyncData> {
  const [projects, habits, habitEntries, tasks] = await Promise.all([
    listProjects(userId),
    listHabits(userId),
    listHabitEntries(userId),
    listTasks(userId),
  ]);
  return { projects, habits, habitEntries, tasks };
}

export async function syncGoalProgress(
  userId: string,
  goalId: string,
  // Callers touching several goals in one action already hold this — passing
  // it in avoids refetching all four collections per goal.
  data?: GoalSyncData,
): Promise<void> {
  const { projects, habits, habitEntries, tasks } =
    data ?? (await loadGoalSyncData(userId));
  const progress = computeGoalProgress(
    goalId,
    projects,
    habits,
    habitEntries,
    tasks,
  );
  if (progress === null) return;
  await updateGoal(userId, goalId, { progress });
}

export async function syncGoalsForProject(
  userId: string,
  projectId: string,
  data?: GoalSyncData,
): Promise<void> {
  await syncGoalsForProjects(userId, [projectId], data);
}

/**
 * Resync every goal touched by any of the given projects, fetching the four
 * source collections once no matter how many projects are named.
 *
 * A bulk action can touch dozens of projects in one call; refetching
 * projects/habits/habitEntries/tasks per project multiplies four reads by
 * however many distinct projects were edited. This fetches once, resolves
 * every project's goal against that one snapshot, and dedupes goal ids before
 * recomputing — a project shared by many moved tasks still recomputes once.
 */
export async function syncGoalsForProjects(
  userId: string,
  projectIds: string[],
  data?: GoalSyncData,
): Promise<void> {
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (!ids.length) return;
  const loaded = data ?? (await loadGoalSyncData(userId));
  const goalIds = new Set<string>();
  for (const projectId of ids) {
    const project = loaded.projects.find((p) => p.id === projectId);
    if (project?.goalId) goalIds.add(project.goalId);
  }
  for (const goalId of goalIds) await syncGoalProgress(userId, goalId, loaded);
}

export async function syncGoalsForHabit(
  userId: string,
  habitId: string,
): Promise<void> {
  const habits = await listHabits(userId);
  const habit = habits.find((h) => h.id === habitId);
  if (habit?.goalIds.length) {
    for (const goalId of habit.goalIds) await syncGoalProgress(userId, goalId);
  }
}

export async function syncAllLinkedGoals(userId: string): Promise<void> {
  const goals = await listGoals(userId);
  for (const goal of goals) {
    await syncGoalProgress(userId, goal.id);
  }
}
