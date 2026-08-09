"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/types";
import {
  getTask,
  updateTask,
  stopRunningTimers,
  accumulateRunningTime,
} from "@/lib/db/tasks";
import { requireUserId } from "@/lib/auth/session";

export async function startTaskTimer(taskId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const task = await getTask(userId, taskId);
  if (!task) return { ok: false, error: "Not found" };
  if (task.timerStartedAt) return { ok: true };

  await stopRunningTimers(userId, taskId);
  const now = new Date().toISOString();
  await updateTask(userId, taskId, {
    timerStartedAt: now,
    status: task.status === "todo" ? "doing" : task.status,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function stopTaskTimer(taskId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const task = await getTask(userId, taskId);
  if (!task) return { ok: false, error: "Not found" };
  if (!task.timerStartedAt) return { ok: true };

  const timeSpentSec = await accumulateRunningTime(task);
  await updateTask(userId, taskId, { timeSpentSec, timerStartedAt: null });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function toggleTaskTimer(taskId: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const task = await getTask(userId, taskId);
  if (!task) return { ok: false, error: "Not found" };
  if (task.timerStartedAt) return stopTaskTimer(taskId);
  return startTaskTimer(taskId);
}

const setTimeSchema = z.object({
  taskId: z.string(),
  timeSpentSec: z.number().min(0),
});

export async function setTaskTimeSpent(
  input: z.infer<typeof setTimeSchema>,
): Promise<ActionResult> {
  const parsed = setTimeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid time" };

  const userId = await requireUserId();
  const task = await getTask(userId, parsed.data.taskId);
  if (!task) return { ok: false, error: "Not found" };

  await updateTask(userId, parsed.data.taskId, {
    timeSpentSec: Math.floor(parsed.data.timeSpentSec),
    timerStartedAt: null,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
