// Pure goal-progress computation. No data-layer imports, so this module is safe
// to import from Client Components. The async sync helpers that read/write the
// database live in lib/goal-sync-server.ts.
import type { Habit, HabitEntry, Project, Task } from "@/lib/schemas";
import { iso, streakOf } from "@/lib/date";
import { projectProgress } from "@/lib/metrics";

export const DEFAULT_HABIT_GOAL_STREAK = 30;

export function habitEntryDates(
  habitId: string,
  habitEntries: HabitEntry[],
): Set<string> {
  return new Set(
    habitEntries.filter((e) => e.habitId === habitId).map((e) => e.date),
  );
}

export function habitStreakProgress(
  habitId: string,
  habitEntries: HabitEntry[],
  targetStreak: number,
  today: string = iso(),
): { streak: number; target: number; progress: number } {
  const target = Math.max(1, targetStreak || DEFAULT_HABIT_GOAL_STREAK);
  const streak = streakOf(habitEntryDates(habitId, habitEntries), today);
  const progress = Math.min(100, Math.round((streak / target) * 100));
  return { streak, target, progress };
}

export function computeGoalProgress(
  goalId: string,
  projects: Project[],
  habits: Habit[],
  habitEntries: HabitEntry[],
  tasks: Task[],
): number | null {
  const linkedProjects = projects.filter((p) => p.goalId === goalId);
  const linkedHabits = habits.filter(
    (h) => h.goalIds.includes(goalId) && !h.archived,
  );

  if (!linkedProjects.length && !linkedHabits.length) return null;

  const parts: number[] = [];

  if (linkedProjects.length) {
    const sum = linkedProjects.reduce(
      (acc, p) => acc + projectProgress(p.id, tasks).progress,
      0,
    );
    parts.push(sum / linkedProjects.length);
  }

  if (linkedHabits.length) {
    const sum = linkedHabits.reduce((acc, h) => {
      const target = h.goalTargetStreak ?? DEFAULT_HABIT_GOAL_STREAK;
      return acc + habitStreakProgress(h.id, habitEntries, target).progress;
    }, 0);
    parts.push(sum / linkedHabits.length);
  }

  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

export function goalProgressBreakdown(
  goalId: string,
  projects: Project[],
  habits: Habit[],
  habitEntries: HabitEntry[],
  tasks: Task[],
) {
  const linkedProjects = linkedProjectsForGoal(goalId, projects);
  const linkedHabits = linkedHabitsForGoal(goalId, habits);
  const projectParts = linkedProjects.map((project) => ({
    project,
    ...projectProgress(project.id, tasks),
  }));
  const habitParts = linkedHabits.map((habit) => ({
    habit,
    ...habitStreakProgress(
      habit.id,
      habitEntries,
      habit.goalTargetStreak ?? DEFAULT_HABIT_GOAL_STREAK,
    ),
  }));
  const overall = computeGoalProgress(
    goalId,
    projects,
    habits,
    habitEntries,
    tasks,
  );

  return { projectParts, habitParts, overall };
}

export function goalHasLinks(
  goalId: string,
  projects: Project[],
  habits: Habit[],
): boolean {
  return (
    projects.some((p) => p.goalId === goalId) ||
    habits.some((h) => h.goalIds.includes(goalId) && !h.archived)
  );
}

export function linkedProjectsForGoal(goalId: string, projects: Project[]) {
  return projects.filter((p) => p.goalId === goalId);
}

export function linkedHabitsForGoal(goalId: string, habits: Habit[]) {
  return habits.filter((h) => h.goalIds.includes(goalId) && !h.archived);
}
