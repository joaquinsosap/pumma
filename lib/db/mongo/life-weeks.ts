import { getDb } from "@/lib/mongodb";
import {
  decryptAllFor,
  decryptFor,
  encryptFor,
} from "@/lib/db/mongo/encrypted";
import { newId } from "@/lib/store/memory";
import { toDto, type LifeWeek, lifeWeekSchema } from "@/lib/schemas";
import type { LifeWeekDoc } from "@/lib/schemas";
import { iso } from "@/lib/date";

async function col() {
  const db = await getDb();
  return db.collection<LifeWeekDoc>("lifeWeeks");
}

export async function listLifeWeeks(userId: string): Promise<LifeWeek[]> {
  const c = await col();
  const docs = await c.find({ userId }).toArray();
  const plain = await decryptAllFor("lifeWeeks", userId, docs);
  return plain.map((w) => toDto(lifeWeekSchema.parse(w)));
}

export async function getLifeWeek(
  userId: string,
  weekStart: string,
): Promise<LifeWeek | null> {
  const c = await col();
  const doc = await c.findOne({ userId, weekStart: weekStart.slice(0, 10) });
  if (!doc) return null;
  return toDto(
    lifeWeekSchema.parse(await decryptFor("lifeWeeks", userId, doc)),
  );
}

export async function upsertLifeWeek(
  doc: Omit<LifeWeekDoc, "_id" | "updatedAt"> & { _id?: string },
): Promise<LifeWeek> {
  const c = await col();
  const weekStart = doc.weekStart.slice(0, 10);
  const existing = await c.findOne({ userId: doc.userId, weekStart });
  const full = {
    ...doc,
    weekStart,
    _id: doc._id ?? existing?._id ?? newId(),
    updatedAt: iso(),
  } as LifeWeekDoc;
  // userId in the filter is defense-in-depth: a doc can only ever be replaced
  // within its owner's scope, so a stray/spoofed _id can't clobber another
  // account's row (it would insert a fresh owned doc instead).
  await c.replaceOne(
    { _id: full._id, userId: doc.userId },
    await encryptFor("lifeWeeks", doc.userId, full),
    { upsert: true },
  );
  return toDto(lifeWeekSchema.parse(full));
}

export async function removeLifeWeeksByDates(
  userId: string,
  dates: string[],
): Promise<void> {
  if (!dates.length) return;
  const c = await col();
  await c.deleteMany({
    userId,
    weekStart: { $in: dates.map((d) => d.slice(0, 10)) },
  });
}
