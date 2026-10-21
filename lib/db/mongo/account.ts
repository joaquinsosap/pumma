import type { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { decryptAllFor, SPECS } from "@/lib/db/mongo/encrypted";
import { redactForExport } from "@/lib/export-redaction";
import { userIdCandidates } from "@/lib/db/mongo/user-id";
import {
  DELETE_ONLY_COLLECTIONS,
  EXPORTED_COLLECTIONS,
} from "@/lib/account-collections";

/**
 * The app writes string `_id`s while the driver's default Document type
 * assumes ObjectId, so collections are opened with a loose row type.
 */
type AnyRow = { _id: string | ObjectId; userId?: string | ObjectId };

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

  for (const name of EXPORTED_COLLECTIONS) {
    const rows = await db.collection<AnyRow>(name).find({ userId }).toArray();
    // Collections absent from SPECS hold nothing encrypted and pass through.
    const readable =
      name in SPECS
        ? await decryptAllFor(name as keyof typeof SPECS, userId, rows)
        : rows;
    out[name] = redactForExport(name, readable);
  }

  // The app-side profile row is keyed by _id, not userId.
  const profile = await db
    .collection<AnyRow>("users")
    .find({ _id: userId })
    .toArray();
  out.profile = redactForExport("users", profile);

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
  const ids = userIdCandidates(userId);

  // Sign-in material first, then everything else this account owns.
  for (const name of DELETE_ONLY_COLLECTIONS) {
    const res = await db
      .collection<AnyRow>(name)
      .deleteMany({ userId: { $in: ids } });
    removed[name] = res.deletedCount ?? 0;
  }

  for (const name of EXPORTED_COLLECTIONS) {
    const res = await db
      .collection<AnyRow>(name)
      .deleteMany({ userId: { $in: ids } });
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
