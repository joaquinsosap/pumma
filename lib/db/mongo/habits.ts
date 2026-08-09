import { getDb } from "@/lib/mongodb";
import {
  decryptAllFor,
  decryptFor,
  encryptFor,
} from "@/lib/db/mongo/encrypted";
import { newId } from "@/lib/store/memory";
import { toDto, type Habit, habitSchema } from "@/lib/schemas";
import type { HabitDoc, HabitEntryDoc } from "@/lib/schemas";

async function col() {
  const db = await getDb();
  return db.collection<HabitDoc>("habits");
}

export async function listHabits(userId: string): Promise<Habit[]> {
  const c = await col();
  const docs = await c.find({ userId }).sort({ order: 1 }).toArray();
  const plain = await decryptAllFor("habits", userId, docs);
  return plain.map((h) => toDto(habitSchema.parse(h)));
}

export async function insertHabit(
  doc: Omit<HabitDoc, "_id"> & { _id?: string },
): Promise<Habit> {
  const c = await col();
  const full = { ...doc, _id: doc._id ?? newId() } as HabitDoc;
  await c.insertOne(await encryptFor("habits", full.userId, full));
  return toDto(habitSchema.parse(full));
}

export async function updateHabit(
  userId: string,
  id: string,
  patch: Partial<HabitDoc>,
): Promise<Habit | null> {
  const c = await col();
  const doc = await c.findOneAndUpdate(
    { _id: id, userId },
    { $set: await encryptFor("habits", userId, patch) },
    { returnDocument: "after" },
  );
  if (!doc) return null;
  return toDto(habitSchema.parse(await decryptFor("habits", userId, doc)));
}

export async function deleteHabit(
  userId: string,
  id: string,
): Promise<boolean> {
  const db = await getDb();
  // A habit's entries are meaningless without it — remove them too.
  await db
    .collection<HabitEntryDoc>("habitEntries")
    .deleteMany({ userId, habitId: id });
  const res = await (await col()).deleteOne({ _id: id, userId });
  return res.deletedCount > 0;
}

/**
 * Persist a new habit order. Same shape as `updateGoalsLayout`: the array
 * position *is* the order, so the caller never computes indices.
 */
export async function updateHabitsOrder(
  userId: string,
  ids: string[],
): Promise<void> {
  const c = await col();
  await Promise.all(
    ids.map((id, order) =>
      c.updateOne({ _id: id, userId }, { $set: { order } }),
    ),
  );
}
