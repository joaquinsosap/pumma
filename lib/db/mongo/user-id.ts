import { ObjectId } from "mongodb";

/**
 * Both spellings of a user id, for querying Better Auth's own collections.
 *
 * The app writes string `_id`s throughout. Better Auth's Mongo adapter writes
 * ObjectIds, so its `user`, `session`, `account` and `oauth*` rows carry an
 * ObjectId in `userId` while everything the app owns carries a string. A query
 * built from the session's user id, which is a string, matches none of them.
 *
 * The failure is silent in the worst way: `find` returns an empty list and
 * `deleteMany` reports zero, so a listing looks like "nothing connected" and a
 * revoke looks like it worked. Exactly that happened to the connected-apps
 * panel, which showed nothing while fourteen consents sat in the database.
 *
 * Shared rather than copied because it had already been written twice by the
 * time it caused a bug, and the second copy is always the one that forgets.
 */
export function userIdCandidates(userId: string): (string | ObjectId)[] {
  const ids: (string | ObjectId)[] = [userId];
  if (ObjectId.isValid(userId)) ids.push(new ObjectId(userId));
  return ids;
}
