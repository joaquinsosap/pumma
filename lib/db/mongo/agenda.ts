import { getDb } from "@/lib/mongodb";
import {
  decryptAllFor,
  decryptFor,
  encryptFor,
} from "@/lib/db/mongo/encrypted";
import { newId } from "@/lib/store/memory";
import { toDto, type AgendaItem, agendaItemSchema } from "@/lib/schemas";
import type { AgendaItemDoc } from "@/lib/schemas";

async function col() {
  const db = await getDb();
  return db.collection<AgendaItemDoc>("agenda");
}

export async function listAgenda(userId: string): Promise<AgendaItem[]> {
  const c = await col();
  const docs = await c.find({ userId }).toArray();
  const plain = await decryptAllFor("agenda", userId, docs);
  return plain.map((a) => toDto(agendaItemSchema.parse(a)));
}

export async function insertAgendaItem(
  doc: Omit<AgendaItemDoc, "_id"> & { _id?: string },
): Promise<AgendaItem> {
  const c = await col();
  const full = agendaItemSchema.parse({ ...doc, _id: doc._id ?? newId() });
  await c.insertOne(await encryptFor("agenda", full.userId, full));
  return toDto(full);
}

export async function getAgendaItem(
  userId: string,
  id: string,
): Promise<AgendaItem | null> {
  const c = await col();
  const doc = await c.findOne({ _id: id, userId });
  if (!doc) return null;
  return toDto(agendaItemSchema.parse(await decryptFor("agenda", userId, doc)));
}

export async function updateAgendaItem(
  userId: string,
  id: string,
  patch: Partial<Omit<AgendaItemDoc, "_id" | "userId">>,
): Promise<AgendaItem | null> {
  const c = await col();
  const doc = await c.findOneAndUpdate(
    { _id: id, userId },
    { $set: await encryptFor("agenda", userId, patch) },
    { returnDocument: "after" },
  );
  if (!doc) return null;
  return toDto(agendaItemSchema.parse(await decryptFor("agenda", userId, doc)));
}

export async function deleteAgendaItem(
  userId: string,
  id: string,
): Promise<boolean> {
  const c = await col();
  const res = await c.deleteOne({ _id: id, userId });
  return res.deletedCount > 0;
}
