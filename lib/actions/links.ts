"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/types";
import { entityId } from "@/lib/validation";
import { requireUserId } from "@/lib/auth/session";
import { getProject, updateProject } from "@/lib/db/projects";
import { updateHabit } from "@/lib/db/habits";
import { listGoals } from "@/lib/db/goals";
import { syncGoalProgress } from "@/lib/goal-sync-server";

/** True when the goal still exists — stale panels can hold ids of deleted goals. */
async function goalExists(userId: string, goalId: string): Promise<boolean> {
  const goals = await listGoals(userId);
  return goals.some((g) => g.id === goalId);
}

const linkSchema = z.object({
  projectId: entityId,
  goalId: entityId.nullable(),
});

const habitAttachSchema = z.object({
  habitId: entityId,
  goalId: entityId,
  targetStreak: z.number().int().min(1).max(999).nullable().optional(),
});

export async function linkProjectToGoal(
  projectId: string,
  goalId: string | null,
): Promise<ActionResult> {
  const parsed = linkSchema.safeParse({ projectId, goalId });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const userId = await requireUserId();
  const project = await getProject(userId, parsed.data.projectId);
  if (!project) return { ok: false, error: "Project not found" };
  if (parsed.data.goalId && !(await goalExists(userId, parsed.data.goalId))) {
    return { ok: false, error: "Goal not found" };
  }

  const previousGoalId = project.goalId;
  await updateProject(userId, parsed.data.projectId, {
    goalId: parsed.data.goalId,
  });

  if (previousGoalId) await syncGoalProgress(userId, previousGoalId);
  if (parsed.data.goalId) await syncGoalProgress(userId, parsed.data.goalId);

  revalidatePath("/", "layout");
  return { ok: true };
}

export async function attachHabitToGoal(
  habitId: string,
  goalId: string,
  targetStreak?: number | null,
): Promise<ActionResult> {
  const parsed = habitAttachSchema.safeParse({ habitId, goalId, targetStreak });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const userId = await requireUserId();
  const habits = await import("@/lib/db/habits").then((m) =>
    m.listHabits(userId),
  );
  const habit = habits.find((h) => h.id === parsed.data.habitId);
  if (!habit) return { ok: false, error: "Habit not found" };
  if (!(await goalExists(userId, parsed.data.goalId))) {
    return { ok: false, error: "Goal not found" };
  }
  if (habit.goalIds.includes(parsed.data.goalId)) return { ok: true };

  await updateHabit(userId, parsed.data.habitId, {
    goalIds: [...habit.goalIds, parsed.data.goalId],
    goalTargetStreak: parsed.data.targetStreak ?? habit.goalTargetStreak ?? 30,
  });

  await syncGoalProgress(userId, parsed.data.goalId);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function detachHabitFromGoal(
  habitId: string,
  goalId: string,
): Promise<ActionResult> {
  if (
    !entityId.safeParse(habitId).success ||
    !entityId.safeParse(goalId).success
  ) {
    return { ok: false, error: "Invalid input" };
  }
  const userId = await requireUserId();
  const habits = await import("@/lib/db/habits").then((m) =>
    m.listHabits(userId),
  );
  const habit = habits.find((h) => h.id === habitId);
  if (!habit) return { ok: false, error: "Habit not found" };

  const nextGoalIds = habit.goalIds.filter((id) => id !== goalId);
  await updateHabit(userId, habitId, {
    goalIds: nextGoalIds,
    goalTargetStreak: nextGoalIds.length ? habit.goalTargetStreak : null,
  });

  await syncGoalProgress(userId, goalId);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** @deprecated use attachHabitToGoal / detachHabitFromGoal */
export async function linkHabitToGoal(
  habitId: string,
  goalId: string | null,
  targetStreak?: number | null,
): Promise<ActionResult> {
  if (goalId) return attachHabitToGoal(habitId, goalId, targetStreak);
  const userId = await requireUserId();
  const habits = await import("@/lib/db/habits").then((m) =>
    m.listHabits(userId),
  );
  const habit = habits.find((h) => h.id === habitId);
  if (!habit) return { ok: false, error: "Habit not found" };
  const previous = [...habit.goalIds];
  await updateHabit(userId, habitId, { goalIds: [], goalTargetStreak: null });
  for (const id of previous) await syncGoalProgress(userId, id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateHabitGoalTargetAction(
  habitId: string,
  targetStreak: number,
): Promise<ActionResult> {
  if (!entityId.safeParse(habitId).success) {
    return { ok: false, error: "Invalid input" };
  }
  if (
    !Number.isFinite(targetStreak) ||
    targetStreak < 1 ||
    targetStreak > 999
  ) {
    return { ok: false, error: "Invalid streak target" };
  }

  const userId = await requireUserId();
  const habits = await import("@/lib/db/habits").then((m) =>
    m.listHabits(userId),
  );
  const habit = habits.find((h) => h.id === habitId);
  if (!habit) return { ok: false, error: "Habit not found" };
  if (!habit.goalIds.length) {
    return { ok: false, error: "Habit is not linked to a goal" };
  }

  await updateHabit(userId, habitId, {
    goalTargetStreak: Math.round(targetStreak),
  });
  for (const goalId of habit.goalIds) await syncGoalProgress(userId, goalId);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function refreshGoalProgress(
  goalId: string,
): Promise<ActionResult> {
  if (!entityId.safeParse(goalId).success) {
    return { ok: false, error: "Invalid input" };
  }
  const userId = await requireUserId();
  await syncGoalProgress(userId, goalId);
  revalidatePath("/", "layout");
  return { ok: true };
}
