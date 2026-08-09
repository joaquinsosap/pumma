import { getStore, newId } from "@/lib/store/memory";
import { toDto, type Note, noteSchema } from "@/lib/schemas";
import type { NoteDoc } from "@/lib/schemas";

export async function listNotes(userId: string): Promise<Note[]> {
  const store = getStore();
  return store.notes
    .filter((n) => n.userId === userId)
    .map((n) => toDto(noteSchema.parse(n)));
}

export async function getNote(
  userId: string,
  id: string,
): Promise<Note | null> {
  const store = getStore();
  const doc = store.notes.find((n) => n._id === id && n.userId === userId);
  return doc ? toDto(noteSchema.parse(doc)) : null;
}

export async function insertNote(
  doc: Omit<NoteDoc, "_id"> & { _id?: string },
): Promise<Note> {
  const store = getStore();
  const full = { ...doc, _id: doc._id ?? newId() };
  store.notes.unshift(full as NoteDoc);
  return toDto(noteSchema.parse(full));
}

export async function updateNote(
  userId: string,
  id: string,
  patch: Partial<NoteDoc>,
): Promise<Note | null> {
  const store = getStore();
  const idx = store.notes.findIndex((n) => n._id === id && n.userId === userId);
  if (idx < 0) return null;
  store.notes[idx] = { ...store.notes[idx], ...patch };
  return toDto(noteSchema.parse(store.notes[idx]));
}

export async function deleteNote(userId: string, id: string): Promise<boolean> {
  const store = getStore();
  const before = store.notes.length;
  store.notes = store.notes.filter(
    (n) => !(n._id === id && n.userId === userId),
  );
  return store.notes.length < before;
}
