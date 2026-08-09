import { getDb } from "@/lib/mongodb";
import { newId } from "@/lib/store/memory";
import { toDto, type LifeDay, lifeDaySchema } from "@/lib/schemas";
import type { LifeDayDoc } from "@/lib/schemas";
import { iso } from "@/lib/date";

async function col() {
  const db = await getDb();
  return db.collection<LifeDayDoc>("lifeDays");
}

export async function listLifeDays(userId: string): Promise<LifeDay[]> {
  const c = await col();
  const docs = await c.find({ userId }).toArray();
  return docs.map((d) => toDto(lifeDaySchema.parse(d)));
}

export async function getLifeDay(
  userId: string,
  date: string,
): Promise<LifeDay | null> {
  const c = await col();
  const doc = await c.findOne({ userId, date: date.slice(0, 10) });
  return doc ? toDto(lifeDaySchema.parse(doc)) : null;
}

export async function upsertLifeDay(
  doc: Omit<LifeDayDoc, "_id" | "updatedAt"> & { _id?: string },
): Promise<LifeDay> {
  const c = await col();
  const date = doc.date.slice(0, 10);
  const existing = await c.findOne({ userId: doc.userId, date });
  const full = {
    ...doc,
    date,
    _id: doc._id ?? existing?._id ?? newId(),
    updatedAt: iso(),
  } as LifeDayDoc;
  // userId in the filter is defense-in-depth: a doc can only ever be replaced
  // within its owner's scope, so a stray/spoofed _id can't clobber another
  // account's row (it would insert a fresh owned doc instead).
  await c.replaceOne({ _id: full._id, userId: doc.userId }, full, {
    upsert: true,
  });
  return toDto(lifeDaySchema.parse(full));
}
