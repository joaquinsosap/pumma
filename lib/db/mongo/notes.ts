import { getDb } from "@/lib/mongodb";
import {
  decryptAllFor,
  decryptFor,
  encryptFor,
} from "@/lib/db/mongo/encrypted";
import { newId } from "@/lib/store/memory";
import { toDto, type Note, noteSchema } from "@/lib/schemas";
import type { NoteDoc } from "@/lib/schemas";

async function col() {
  const db = await getDb();
  return db.collection<NoteDoc>("notes");
}

export async function listNotes(userId: string): Promise<Note[]> {
  const c = await col();
  // createdAt desc approximates the memory store's unshift (newest first).
  const docs = await c.find({ userId }).sort({ createdAt: -1 }).toArray();
  const plain = await decryptAllFor("notes", userId, docs);
  return plain.map((n) => toDto(noteSchema.parse(n)));
}

export async function getNote(
  userId: string,
  id: string,
): Promise<Note | null> {
  const c = await col();
  const doc = await c.findOne({ _id: id, userId });
  if (!doc) return null;
  return toDto(noteSchema.parse(await decryptFor("notes", userId, doc)));
}

export async function insertNote(
  doc: Omit<NoteDoc, "_id"> & { _id?: string },
): Promise<Note> {
  const c = await col();
  const full = { ...doc, _id: doc._id ?? newId() } as NoteDoc;
  await c.insertOne(await encryptFor("notes", full.userId, full));
  return toDto(noteSchema.parse(full));
}

export async function updateNote(
  userId: string,
  id: string,
  patch: Partial<NoteDoc>,
): Promise<Note | null> {
  const c = await col();
  const doc = await c.findOneAndUpdate(
    { _id: id, userId },
    { $set: await encryptFor("notes", userId, patch) },
    { returnDocument: "after" },
  );
  if (!doc) return null;
  return toDto(noteSchema.parse(await decryptFor("notes", userId, doc)));
}

export async function deleteNote(userId: string, id: string): Promise<boolean> {
  const c = await col();
  const res = await c.deleteOne({ _id: id, userId });
  return res.deletedCount > 0;
}
