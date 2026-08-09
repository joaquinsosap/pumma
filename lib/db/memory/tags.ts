import { getStore, newId } from "@/lib/store/memory";
import { SPECIAL_LIFE_TAGS, LIFE_TAG_COLORS } from "@/lib/life-area-sync";
import { toDto, type Tag, tagSchema } from "@/lib/schemas";
import type { TagDoc } from "@/lib/schemas";
import { TAG_PALETTE } from "@/lib/types";
import { iso } from "@/lib/date";

export async function listTags(userId: string): Promise<Tag[]> {
  const store = getStore();
  return store.tags
    .filter((t) => t.userId === userId)
    .sort((a, b) => a.order - b.order)
    .map((t) => toDto(tagSchema.parse(t)));
}

export async function getTagByName(
  userId: string,
  name: string,
): Promise<Tag | null> {
  const store = getStore();
  const doc = store.tags.find((t) => t.userId === userId && t.name === name);
  return doc ? toDto(tagSchema.parse(doc)) : null;
}

export async function insertTag(
  userId: string,
  name: string,
  opts?: {
    projectId?: string | null;
    isProjectPrimary?: boolean;
    color?: string;
  },
): Promise<Tag | null> {
  const store = getStore();
  if (store.tags.some((t) => t.userId === userId && t.name === name))
    return null;
  const mine = store.tags.filter((t) => t.userId === userId);
  const tag: TagDoc = {
    _id: newId(),
    userId,
    name,
    color: opts?.color ?? TAG_PALETTE[mine.length % TAG_PALETTE.length],
    isDefault: false,
    projectId: opts?.projectId ?? null,
    isProjectPrimary: opts?.isProjectPrimary ?? false,
    order: mine.length,
    createdAt: iso(),
  };
  store.tags.push(tag);
  return toDto(tagSchema.parse(tag));
}

/**
 * The two life tags every account has. They carry the personal/work split, so
 * they're created up front and can't be removed — see isLifeTag.
 */
export async function ensureLifeTags(userId: string): Promise<void> {
  const store = getStore();
  SPECIAL_LIFE_TAGS.forEach((name, i) => {
    if (store.tags.some((t) => t.userId === userId && t.name === name)) return;
    store.tags.push({
      _id: newId(),
      userId,
      name,
      color: LIFE_TAG_COLORS[name],
      isDefault: true,
      projectId: null,
      isProjectPrimary: false,
      order: i,
      createdAt: iso(),
    });
  });
}

export async function updateTag(
  userId: string,
  id: string,
  patch: { name?: string; color?: string },
): Promise<Tag | null> {
  const store = getStore();
  const idx = store.tags.findIndex((t) => t._id === id && t.userId === userId);
  if (idx < 0) return null;
  if (
    patch.name &&
    store.tags.some(
      (t) => t.userId === userId && t.name === patch.name && t._id !== id,
    )
  ) {
    return null;
  }
  store.tags[idx] = { ...store.tags[idx], ...patch };
  return toDto(tagSchema.parse(store.tags[idx]));
}

/** Re-insert whole tag docs — used to undo a cleanup, so ids/colors survive. */
export async function restoreTags(
  userId: string,
  docs: TagDoc[],
): Promise<number> {
  const store = getStore();
  let restored = 0;
  for (const doc of docs) {
    if (store.tags.some((t) => t._id === doc._id && t.userId === userId))
      continue;
    store.tags.push({ ...doc, userId });
    restored += 1;
  }
  return restored;
}

export async function deleteTag(userId: string, id: string): Promise<boolean> {
  const store = getStore();
  const idx = store.tags.findIndex((t) => t._id === id && t.userId === userId);
  if (idx < 0) return false;
  for (const t of store.tasks) {
    if (t.userId === userId && t.tagIds.includes(id)) {
      t.tagIds = t.tagIds.filter((x) => x !== id);
    }
  }
  for (const n of store.notes) {
    if (n.userId === userId && n.tagIds.includes(id)) {
      n.tagIds = n.tagIds.filter((x) => x !== id);
    }
  }
  store.tags.splice(idx, 1);
  return true;
}

export async function ensureTags(
  userId: string,
  names: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    let tag = await getTagByName(userId, name);
    if (!tag) {
      tag = (await insertTag(userId, name))!;
    }
    ids.push(tag.id);
  }
  return ids;
}

export async function detachTagFromProject(
  userId: string,
  id: string,
): Promise<void> {
  const store = getStore();
  const tag = store.tags.find((t) => t._id === id && t.userId === userId);
  if (!tag) return;
  tag.projectId = null;
  tag.isProjectPrimary = false;
}

export async function setTagProject(
  userId: string,
  id: string,
  projectId: string,
  opts: { primary?: boolean } = {},
): Promise<void> {
  const store = getStore();
  const tag = store.tags.find((t) => t._id === id && t.userId === userId);
  if (!tag) return;
  tag.projectId = projectId;
  if (opts.primary !== undefined) tag.isProjectPrimary = opts.primary;
}
