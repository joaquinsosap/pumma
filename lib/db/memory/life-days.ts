import { getStore, newId } from "@/lib/store/memory";
import { toDto, type LifeDay, lifeDaySchema } from "@/lib/schemas";
import type { LifeDayDoc } from "@/lib/schemas";
import { iso } from "@/lib/date";

export async function listLifeDays(userId: string): Promise<LifeDay[]> {
  const store = getStore();
  return store.lifeDays
    .filter((d) => d.userId === userId)
    .map((d) => toDto(lifeDaySchema.parse(d)));
}

export async function getLifeDay(
  userId: string,
  date: string,
): Promise<LifeDay | null> {
  const store = getStore();
  const doc = store.lifeDays.find(
    (d) => d.userId === userId && d.date === date.slice(0, 10),
  );
  return doc ? toDto(lifeDaySchema.parse(doc)) : null;
}

export async function upsertLifeDay(
  doc: Omit<LifeDayDoc, "_id" | "updatedAt"> & { _id?: string },
): Promise<LifeDay> {
  const store = getStore();
  const date = doc.date.slice(0, 10);
  const idx = store.lifeDays.findIndex(
    (d) => d.userId === doc.userId && d.date === date,
  );
  const updatedAt = iso();
  const full = {
    ...doc,
    date,
    _id: doc._id ?? (idx >= 0 ? store.lifeDays[idx]._id : newId()),
    updatedAt,
  };
  if (idx >= 0) {
    store.lifeDays[idx] = full as LifeDayDoc;
  } else {
    store.lifeDays.push(full as LifeDayDoc);
  }
  return toDto(lifeDaySchema.parse(full));
}
