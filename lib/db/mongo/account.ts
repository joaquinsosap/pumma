import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

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

export async function exportUserData(
  userId: string,
): Promise<Record<string, unknown[]>> {
  const db = await getDb();
  const out: Record<string, unknown[]> = {};
  for (const name of USER_COLLECTIONS) {
    out[name] = await db.collection<AnyRow>(name).find({ userId }).toArray();
  }
  // The app-side profile row is keyed by _id, not userId.
  out.profile = await db
    .collection<AnyRow>("users")
    .find({ _id: userId })
    .toArray();
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
