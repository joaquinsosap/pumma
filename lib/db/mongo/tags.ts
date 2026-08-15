import { getDb } from "@/lib/mongodb";
import {
  blindIndexFor,
  decryptAllFor,
  decryptFor,
  encryptFor,
} from "@/lib/db/mongo/encrypted";
import { SPECIAL_LIFE_TAGS, LIFE_TAG_COLORS } from "@/lib/life-area-sync";
import { newId } from "@/lib/store/memory";
import { toDto, type Tag, tagSchema } from "@/lib/schemas";
import type { NoteDoc, TagDoc, TaskDoc } from "@/lib/schemas";
import { TAG_PALETTE } from "@/lib/types";
import { iso } from "@/lib/date";

/**
 * `nameKey` is storage-only: an HMAC of the lowercased name under the user's
 * own data key. The encrypted `name` cannot be searched or constrained — every
 * write produces different bytes — so this carries the unique index and every
 * lookup-by-name instead. It is deliberately absent from tagSchema, so it is
 * stripped on the way out and never reaches a client.
 */
type StoredTag = TagDoc & { nameKey?: string };

async function col() {
  const db = await getDb();
  return db.collection<StoredTag>("tags");
}

/**
 * Find a tag by name, tolerating rows written before encryption.
 *
 * The fallback is what lets the backfill run against a live database: a row
 * that has no nameKey yet is still findable by its plaintext name.
 */
async function findByName(
  c: Awaited<ReturnType<typeof col>>,
  userId: string,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<StoredTag | null> {
  const nameKey = await blindIndexFor(userId, name);
  const byKey = await c.findOne({ userId, nameKey, ...extra } as never);
  if (byKey) return byKey;
  return c.findOne({ userId, name, ...extra } as never);
}

export async function listTags(userId: string): Promise<Tag[]> {
  const c = await col();
  const docs = await c.find({ userId }).sort({ order: 1 }).toArray();
  const plain = await decryptAllFor("tags", userId, docs);
  return plain.map((t) => toDto(tagSchema.parse(t)));
}

export async function getTagByName(
  userId: string,
  name: string,
): Promise<Tag | null> {
  const c = await col();
  const doc = await findByName(c, userId, name);
  if (!doc) return null;
  return toDto(tagSchema.parse(await decryptFor("tags", userId, doc)));
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
  const c = await col();
  const existing = await findByName(c, userId, name);
  if (existing) return null;
  const count = await c.countDocuments({ userId });
  const tag: TagDoc = {
    _id: newId(),
    userId,
    name,
    color: opts?.color ?? TAG_PALETTE[count % TAG_PALETTE.length],
    isDefault: false,
    projectId: opts?.projectId ?? null,
    isProjectPrimary: opts?.isProjectPrimary ?? false,
    order: count,
    createdAt: iso(),
  };
  await c.insertOne({
    ...(await encryptFor("tags", userId, tag)),
    nameKey: await blindIndexFor(userId, name),
  });
  return toDto(tagSchema.parse(tag));
}

/**
 * The two life tags every account has. They carry the personal/work split, so
 * they're created up front and can't be removed — see isLifeTag.
 */
export async function ensureLifeTags(userId: string): Promise<void> {
  const c = await col();
  for (const [i, name] of SPECIAL_LIFE_TAGS.entries()) {
    // Find-then-insert rather than an upsert keyed on the name: post-migration
    // the name is ciphertext that differs every write, so an upsert filtered
    // on it would match nothing and mint a duplicate every call. The unique
    // {userId, nameKey} index is what makes the race safe.
    if (await findByName(c, userId, name)) continue;
    const doc: TagDoc = {
      _id: newId(),
      userId,
      name,
      color: LIFE_TAG_COLORS[name],
      isDefault: true,
      projectId: null,
      isProjectPrimary: false,
      order: i,
      createdAt: iso(),
    };
    await c.insertOne({
      ...(await encryptFor("tags", userId, doc)),
      nameKey: await blindIndexFor(userId, name),
    });
  }
}

export async function updateTag(
  userId: string,
  id: string,
  patch: { name?: string; color?: string; order?: number },
): Promise<Tag | null> {
  const c = await col();
  if (patch.name) {
    // Names are unique per user — reject a rename that collides.
    const clash = await findByName(c, userId, patch.name, { _id: { $ne: id } });
    if (clash) return null;
  }
  // A rename has to move the blind index with it, or the row keeps answering
  // to its old name and stops answering to its new one.
  const $set: Record<string, unknown> = await encryptFor("tags", userId, patch);
  if (patch.name) $set.nameKey = await blindIndexFor(userId, patch.name);

  const doc = await c.findOneAndUpdate(
    { _id: id, userId },
    { $set },
    { returnDocument: "after" },
  );
  if (!doc) return null;
  return toDto(tagSchema.parse(await decryptFor("tags", userId, doc)));
}

/** Re-insert whole tag docs — used to undo a cleanup, so ids/colors survive. */
export async function restoreTags(
  userId: string,
  docs: TagDoc[],
): Promise<number> {
  if (!docs.length) return 0;
  const c = await col();
  let restored = 0;
  for (const doc of docs) {
    // Scoped + idempotent: never let a stale undo write into another account.
    const res = await c.updateOne(
      { _id: doc._id, userId },
      {
        $setOnInsert: {
          ...(await encryptFor("tags", userId, { ...doc, userId })),
          nameKey: await blindIndexFor(userId, doc.name),
        },
      },
      { upsert: true },
    );
    if (res.upsertedCount) restored += 1;
  }
  return restored;
}

export async function deleteTag(userId: string, id: string): Promise<boolean> {
  const db = await getDb();
  // Detach from everything that references it, then remove the tag itself.
  await Promise.all([
    db
      .collection<TaskDoc>("tasks")
      .updateMany({ userId, tagIds: id }, { $pull: { tagIds: id } }),
    db
      .collection<NoteDoc>("notes")
      .updateMany({ userId, tagIds: id }, { $pull: { tagIds: id } }),
  ]);
  const res = await (await col()).deleteOne({ _id: id, userId });
  return res.deletedCount > 0;
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
  const c = await col();
  await c.updateOne(
    { _id: id, userId },
    { $set: { projectId: null, isProjectPrimary: false } },
  );
}

export async function setTagProject(
  userId: string,
  id: string,
  projectId: string,
  opts: { primary?: boolean } = {},
): Promise<void> {
  const c = await col();
  await c.updateOne(
    { _id: id, userId },
    {
      $set: {
        projectId,
        ...(opts.primary === undefined
          ? {}
          : { isProjectPrimary: opts.primary }),
      },
    },
  );
}
