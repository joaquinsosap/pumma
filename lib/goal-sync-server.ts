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

export async function syncGoalProgress(
  userId: string,
  goalId: string,
): Promise<void> {
  const [projects, habits, habitEntries, tasks] = await Promise.all([
    listProjects(userId),
    listHabits(userId),
    listHabitEntries(userId),
    listTasks(userId),
  ]);
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
): Promise<void> {
  const projects = await listProjects(userId);
  const project = projects.find((p) => p.id === projectId);
  if (project?.goalId) await syncGoalProgress(userId, project.goalId);
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
