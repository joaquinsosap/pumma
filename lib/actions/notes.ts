"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/types";
import { requireUserId } from "@/lib/auth/session";
import { userToday } from "@/lib/timezone-server";
import { entityId, noteBody, title } from "@/lib/validation";
import { insertNote, updateNote, deleteNote, getNote } from "@/lib/db/notes";
import { insertTask } from "@/lib/db/tasks";
import { listTags, ensureLifeTags } from "@/lib/db/tags";
import { deriveLifeAreaFromTags, withLifeTags } from "@/lib/life-area-sync";
import type { LifeView } from "@/lib/types";

export async function createNote(
  view: LifeView = "personal",
): Promise<ActionResult<{ id: string }>> {
  const userId = await requireUserId();
  const { today: td } = await userToday();
  await ensureLifeTags(userId);
  const tags = await listTags(userId);
  const tagIds = withLifeTags([], view, tags);
  const note = await insertNote({
    userId,
    title: "Untitled note",
    body: "",
    tagIds,
    pinned: false,
    lifeArea: deriveLifeAreaFromTags(tagIds, tags),
    createdAt: td,
    updatedAt: td,
  });
  revalidatePath("/", "layout");
  return { ok: true, data: { id: note.id } };
}

const updateNoteSchema = z.discriminatedUnion("field", [
  z.object({ id: entityId, field: z.literal("title"), value: title }),
  z.object({ id: entityId, field: z.literal("body"), value: noteBody }),
]);

export async function updateNoteAction(
  id: string,
  field: "title" | "body",
  value: string,
): Promise<ActionResult> {
  const parsed = updateNoteSchema.safeParse({ id, field, value });
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  const { today: td } = await userToday();
  await updateNote(userId, parsed.data.id, {
    [parsed.data.field]: parsed.data.value,
    updatedAt: td,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function toggleNotePin(id: string): Promise<ActionResult> {
  const parsed = entityId.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  const note = await getNote(userId, parsed.data);
  if (!note) return { ok: false, error: "Not found" };
  await updateNote(userId, parsed.data, { pinned: !note.pinned });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteNoteAction(id: string): Promise<ActionResult> {
  const parsed = entityId.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  const note = await getNote(userId, parsed.data);
  if (!note) return { ok: false, error: "Not found" };
  await deleteNote(userId, parsed.data);
  revalidatePath("/", "layout");
  return {
    ok: true,
    undo: { type: "delete", entity: "note", snapshot: note },
  };
}

export async function convertNoteToTask(id: string): Promise<ActionResult> {
  const parsed = entityId.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  const note = await getNote(userId, parsed.data);
  if (!note) return { ok: false, error: "Not found" };
  const { today: td } = await userToday();
  const tags = await listTags(userId);
  await insertTask({
    userId,
    title: note.title,
    // The note's content carries over as the task's description.
    description: note.body,
    tagIds: note.tagIds,
    priority: "med",
    status: "todo",
    due: td,
    projectId: null,
    goalId: null,
    lifeArea: deriveLifeAreaFromTags(note.tagIds, tags),
    order: -Date.now(),
    createdAt: td,
    completedAt: null,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
