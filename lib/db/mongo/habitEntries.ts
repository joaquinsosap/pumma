import { getDb } from "@/lib/mongodb";
import { newId } from "@/lib/store/memory";
import { toDto, type HabitEntry, habitEntrySchema } from "@/lib/schemas";
import type { HabitEntryDoc } from "@/lib/schemas";

async function col() {
  const db = await getDb();
  return db.collection<HabitEntryDoc>("habitEntries");
}

export async function listHabitEntries(userId: string): Promise<HabitEntry[]> {
  const c = await col();
  const docs = await c.find({ userId }).toArray();
  return docs.map((e) => toDto(habitEntrySchema.parse(e)));
}

export async function toggleHabitEntry(
  userId: string,
  habitId: string,
  date: string,
): Promise<boolean> {
  const c = await col();
  const existing = await c.findOne({ userId, habitId, date });
  if (existing) {
    await c.deleteOne({ _id: existing._id });
    return false;
  }
  await c.insertOne({ _id: newId(), userId, habitId, date, done: true });
  return true;
}

/** Entries for one habit inside an inclusive date range. */
export async function habitEntriesInRange(
  userId: string,
  habitId: string,
  start: string,
  end: string,
): Promise<HabitEntry[]> {
  const c = await col();
  const docs = await c
    .find({ userId, habitId, date: { $gte: start, $lte: end } })
    .toArray();
  return docs.map((e) => toDto(habitEntrySchema.parse(e)));
}

/** Remove every entry for one habit inside an inclusive date range. */
export async function clearHabitEntriesInRange(
  userId: string,
  habitId: string,
  start: string,
  end: string,
): Promise<number> {
  const c = await col();
  const res = await c.deleteMany({
    userId,
    habitId,
    date: { $gte: start, $lte: end },
  });
  return res.deletedCount ?? 0;
}

/** Record a single completion (idempotent). */
export async function markHabitEntry(
  userId: string,
  habitId: string,
  date: string,
): Promise<void> {
  const c = await col();
  await c.updateOne(
    { userId, habitId, date },
    { $setOnInsert: { _id: newId(), userId, habitId, date, done: true } },
    { upsert: true },
  );
}
