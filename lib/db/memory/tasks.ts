import { getStore, newId } from "@/lib/store/memory";
import { toDto, type Task, taskSchema } from "@/lib/schemas";
import type { Subtask, TaskDoc } from "@/lib/schemas";

export async function listTasks(userId: string): Promise<Task[]> {
  const store = getStore();
  return store.tasks
    .filter((t) => t.userId === userId)
    .map((t) => toDto(taskSchema.parse(t)));
}

export async function getTask(
  userId: string,
  id: string,
): Promise<Task | null> {
  const store = getStore();
  const doc = store.tasks.find((t) => t._id === id && t.userId === userId);
  return doc ? toDto(taskSchema.parse(doc)) : null;
}

export async function getTasksByDue(
  userId: string,
  date: string,
): Promise<Task[]> {
  const tasks = await listTasks(userId);
  return tasks.filter((t) => (t.due ?? "").slice(0, 10) === date);
}

export async function getCarryoverTasks(
  userId: string,
  today: string,
): Promise<Task[]> {
  const tasks = await listTasks(userId);
  return tasks.filter(
    (t) =>
      t.status !== "done" &&
      (t.due ?? "").slice(0, 10) < today &&
      (t.due ?? "") !== "",
  );
}

export async function getTasksByProject(
  userId: string,
  projectId: string,
): Promise<Task[]> {
  const tasks = await listTasks(userId);
  return tasks.filter((t) => t.projectId === projectId);
}

export async function insertTask(
  doc: Omit<
    TaskDoc,
    "_id" | "timeSpentSec" | "timerStartedAt" | "description" | "subtasks"
  > & {
    _id?: string;
    timeSpentSec?: number;
    timerStartedAt?: string | null;
    description?: string;
    subtasks?: Subtask[];
  },
): Promise<Task> {
  const store = getStore();
  const full = {
    description: "",
    subtasks: [],
    timeSpentSec: 0,
    timerStartedAt: null,
    ...doc,
    _id: doc._id ?? newId(),
  };
  store.tasks.unshift(full as TaskDoc);
  return toDto(taskSchema.parse(full));
}

export async function updateTask(
  userId: string,
  id: string,
  patch: Partial<TaskDoc>,
): Promise<Task | null> {
  const store = getStore();
  const idx = store.tasks.findIndex((t) => t._id === id && t.userId === userId);
  if (idx < 0) return null;
  store.tasks[idx] = { ...store.tasks[idx], ...patch };
  return toDto(taskSchema.parse(store.tasks[idx]));
}

export async function getRunningTimerTask(
  userId: string,
): Promise<Task | null> {
  const tasks = await listTasks(userId);
  return tasks.find((t) => t.timerStartedAt) ?? null;
}

async function accumulateRunningTime(task: Task): Promise<number> {
  if (!task.timerStartedAt) return task.timeSpentSec;
  const elapsed = Math.floor(
    (Date.now() - new Date(task.timerStartedAt).getTime()) / 1000,
  );
  return task.timeSpentSec + Math.max(0, elapsed);
}

export async function stopRunningTimers(
  userId: string,
  exceptId?: string,
): Promise<void> {
  const tasks = await listTasks(userId);
  for (const task of tasks) {
    if (!task.timerStartedAt || task.id === exceptId) continue;
    const timeSpentSec = await accumulateRunningTime(task);
    await updateTask(userId, task.id, { timeSpentSec, timerStartedAt: null });
  }
}

export { accumulateRunningTime };

export async function deleteTask(userId: string, id: string): Promise<boolean> {
  const store = getStore();
  const before = store.tasks.length;
  store.tasks = store.tasks.filter(
    (t) => !(t._id === id && t.userId === userId),
  );
  return store.tasks.length < before;
}
