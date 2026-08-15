import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { decryptAllFor, SPECS } from "@/lib/db/mongo/encrypted";
import { NEVER_EXPORT } from "@/lib/export-redaction";

function stripSecrets<T>(rows: T[]): T[] {
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const copy = { ...(row as Record<string, unknown>) };
    for (const field of NEVER_EXPORT) delete copy[field];
    return copy as T;
  });
}

/**
 * Every collection that holds something belonging to a user, keyed by userId.
 *
 * If you add a collection, add it here — an export that quietly omits a
 * collection is a broken promise, and a delete that does is worse.
 */
export const USER_COLLECTIONS = [
  "agenda",
  "goals",
  "habitEntries",
  "habits",
  "lifeDays",
  "lifeWeeks",
  "notes",
  "projects",
  "settings",
  "subscriptions",
  "tags",
  "tasks",
] as const;

export type UserCollection = (typeof USER_COLLECTIONS)[number];

/**
 * The app writes string `_id`s while the driver's default Document type
 * assumes ObjectId, so collections are opened with a loose row type.
 */
type AnyRow = { _id: string | ObjectId; userId?: string };

/** Better Auth writes its own `_id`, which may be a string or an ObjectId. */
function idCandidates(userId: string): (string | ObjectId)[] {
  const ids: (string | ObjectId)[] = [userId];
  if (ObjectId.isValid(userId)) ids.push(new ObjectId(userId));
  return ids;
}

/**
 * Everything this account owns, readable.
 *
 * The rows come straight from Mongo rather than through the repositories,
 * because the repositories return the app's DTOs and an export wants the
 * records as stored. That shortcut had a cost nobody noticed: it also skipped
 * the decryption boundary, so every title, note body and tag name arrived as
 * ciphertext and the file was worthless to the person who asked for it.
 *
 * So it decrypts explicitly, with the same helper the repositories use and
 * the same key — this user's own, derived from the session id the caller
 * passed. There is no path here that can decrypt somebody else's rows: the
 * query is scoped by `userId` and the key is derived from that same value.
 */
export async function exportUserData(
  userId: string,
): Promise<Record<string, unknown[]>> {
  const db = await getDb();
  const out: Record<string, unknown[]> = {};

  for (const name of USER_COLLECTIONS) {
    const rows = await db.collection<AnyRow>(name).find({ userId }).toArray();
    // Collections absent from SPECS hold nothing encrypted and pass through.
    const readable =
      name in SPECS
        ? await decryptAllFor(name as keyof typeof SPECS, userId, rows)
        : rows;
    out[name] = stripSecrets(readable);
  }

  // The app-side profile row is keyed by _id, not userId.
  const profile = await db
    .collection<AnyRow>("users")
    .find({ _id: userId })
    .toArray();
  out.profile = stripSecrets(profile);

  return out;
}

/**
 * Remove every trace of an account: app data, the profile row, and the Better
 * Auth records that let anyone sign back in.
 *
 * Sessions and credentials go first. If the process dies midway, the worst
 * outcome is orphaned rows nobody can reach, rather than a live login pointing
 * at half-deleted data.
 */
export async function deleteAllUserData(
  userId: string,
): Promise<Record<string, number>> {
  const db = await getDb();
  const removed: Record<string, number> = {};
  const ids = idCandidates(userId);

  for (const name of ["session", "account"]) {
    const res = await db
      .collection<AnyRow>(name)
      .deleteMany({ userId: { $in: ids as string[] } });
    removed[name] = res.deletedCount ?? 0;
  }

  for (const name of USER_COLLECTIONS) {
    const res = await db.collection<AnyRow>(name).deleteMany({ userId });
    removed[name] = res.deletedCount ?? 0;
  }

  const profile = await db
    .collection<AnyRow>("users")
    .deleteOne({ _id: userId });
  removed.profile = profile.deletedCount ?? 0;

  const authUser = await db
    .collection<AnyRow>("user")
    .deleteMany({ _id: { $in: ids } });
  removed.user = authUser.deletedCount ?? 0;

  return removed;
}
