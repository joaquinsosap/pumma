import { getStore, newId } from "@/lib/store/memory";
import { toDto, type AgendaItem, agendaItemSchema } from "@/lib/schemas";
import type { AgendaItemDoc } from "@/lib/schemas";

export async function listAgenda(userId: string): Promise<AgendaItem[]> {
  const store = getStore();
  return store.agenda
    .filter((a) => a.userId === userId)
    .map((a) => toDto(agendaItemSchema.parse(a)));
}

export async function insertAgendaItem(
  doc: Omit<AgendaItemDoc, "_id"> & { _id?: string },
): Promise<AgendaItem> {
  const store = getStore();
  const full = agendaItemSchema.parse({ ...doc, _id: doc._id ?? newId() });
  store.agenda.push(full);
  return toDto(full);
}

export async function getAgendaItem(
  userId: string,
  id: string,
): Promise<AgendaItem | null> {
  const store = getStore();
  const doc = store.agenda.find((a) => a._id === id && a.userId === userId);
  return doc ? toDto(agendaItemSchema.parse(doc)) : null;
}

export async function updateAgendaItem(
  userId: string,
  id: string,
  patch: Partial<Omit<AgendaItemDoc, "_id" | "userId">>,
): Promise<AgendaItem | null> {
  const store = getStore();
  const idx = store.agenda.findIndex(
    (a) => a._id === id && a.userId === userId,
  );
  if (idx < 0) return null;
  const next = agendaItemSchema.parse({ ...store.agenda[idx], ...patch });
  store.agenda[idx] = next;
  return toDto(next);
}

export async function deleteAgendaItem(
  userId: string,
  id: string,
): Promise<boolean> {
  const store = getStore();
  const idx = store.agenda.findIndex(
    (a) => a._id === id && a.userId === userId,
  );
  if (idx < 0) return false;
  store.agenda.splice(idx, 1);
  return true;
}
