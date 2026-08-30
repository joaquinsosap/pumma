import { getDb } from "@/lib/mongodb";
import {
  decryptAllFor,
  decryptFor,
  encryptFor,
} from "@/lib/db/mongo/encrypted";
import { newId } from "@/lib/store/memory";
import { toDto, type Task, taskSchema } from "@/lib/schemas";
import type { Subtask, TaskDoc } from "@/lib/schemas";

async function col() {
  const db = await getDb();
  return db.collection<TaskDoc>("tasks");
}

/** The shape insertTask/insertTasks accept: a doc with everything but the
 * defaulted fields, plus an optional client-chosen _id (undo restores one). */
type NewTaskDoc = Omit<
  TaskDoc,
  "_id" | "timeSpentSec" | "timerStartedAt" | "description" | "subtasks"
> & {
  _id?: string;
  timeSpentSec?: number;
  timerStartedAt?: string | null;
  description?: string;
  subtasks?: Subtask[];
};

export async function listTasks(userId: string): Promise<Task[]> {
  const c = await col();
  // createdAt desc approximates the memory store's unshift (newest first);
  // order asc keeps same-day seed tasks stable. UI re-sorts where it matters.
  const docs = await c
    .find({ userId })
    .sort({ createdAt: -1, order: 1 })
    .toArray();
  const plain = await decryptAllFor("tasks", userId, docs);
  return plain.map((t) => toDto(taskSchema.parse(t)));
}

export async function getTask(
  userId: string,
  id: string,
): Promise<Task | null> {
  const c = await col();
  const doc = await c.findOne({ _id: id, userId });
  if (!doc) return null;
  return toDto(taskSchema.parse(await decryptFor("tasks", userId, doc)));
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

/** One query for a bounded set of ids, instead of one getTask per id. */
export async function getTasksByIds(
  userId: string,
  ids: string[],
): Promise<Task[]> {
  if (!ids.length) return [];
  const c = await col();
  const docs = await c.find({ userId, _id: { $in: ids } }).toArray();
  const plain = await decryptAllFor("tasks", userId, docs);
  return plain.map((t) => toDto(taskSchema.parse(t)));
}

export async function insertTask(doc: NewTaskDoc): Promise<Task> {
  const c = await col();
  const full: TaskDoc = {
    description: "",
    subtasks: [],
    timeSpentSec: 0,
    timerStartedAt: null,
    ...doc,
    _id: doc._id ?? newId(),
  } as TaskDoc;
  // Encrypt on the way in, return the plaintext we already hold — no second
  // round trip, and the caller gets what it just wrote.
  await c.insertOne(await encryptFor("tasks", full.userId, full));
  return toDto(taskSchema.parse(full));
}

/** insertTask for a batch: one insertMany instead of N insertOne round trips.
 * Used by undo-delete, which restores a whole batch at once. */
export async function insertTasks(docs: NewTaskDoc[]): Promise<Task[]> {
  if (!docs.length) return [];
  const c = await col();
  const fulls: TaskDoc[] = docs.map(
    (doc) =>
      ({
        description: "",
        subtasks: [],
        timeSpentSec: 0,
        timerStartedAt: null,
        ...doc,
        _id: doc._id ?? newId(),
      }) as TaskDoc,
  );
  const encrypted = await Promise.all(
    fulls.map((full) => encryptFor("tasks", full.userId, full)),
  );
  await c.insertMany(encrypted);
  return fulls.map((full) => toDto(taskSchema.parse(full)));
}

export async function updateTask(
  userId: string,
  id: string,
  patch: Partial<TaskDoc>,
): Promise<Task | null> {
  const c = await col();
  const doc = await c.findOneAndUpdate(
    { _id: id, userId },
    { $set: await encryptFor("tasks", userId, patch) },
    { returnDocument: "after" },
  );
  if (!doc) return null;
  return toDto(taskSchema.parse(await decryptFor("tasks", userId, doc)));
}

/**
 * updateTask for a batch: one bulkWrite instead of N findOneAndUpdate round
 * trips. Each id may carry its own patch (moveTaskOnBoard gives every task a
 * different `order`), so this takes pairs rather than one shared patch.
 * Returns how many ids actually matched an existing task.
 */
export async function updateTasks(
  userId: string,
  patches: { id: string; patch: Partial<TaskDoc> }[],
): Promise<number> {
  if (!patches.length) return 0;
  const c = await col();
  const ops = await Promise.all(
    patches.map(async ({ id, patch }) => ({
      updateOne: {
        filter: { _id: id, userId },
        update: { $set: await encryptFor("tasks", userId, patch) },
      },
    })),
  );
  const res = await c.bulkWrite(ops);
  return res.matchedCount;
}

/** deleteTask for a batch: one deleteMany instead of N deleteOne round trips. */
export async function deleteTasks(
  userId: string,
  ids: string[],
): Promise<number> {
  if (!ids.length) return 0;
  const c = await col();
  const res = await c.deleteMany({ userId, _id: { $in: ids } });
  return res.deletedCount;
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
  const c = await col();
  const res = await c.deleteOne({ _id: id, userId });
  return res.deletedCount > 0;
}
