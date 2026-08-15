/**
 * Fields that must never appear in an export, whatever collection they sit in.
 *
 * Two backends and one route handler all need this list, and a field that is
 * redacted in one place and forgotten in another is not redacted at all. It
 * lives on its own, free of imports, so the memory store, the Mongo layer and
 * the download route can each read it without dragging the others in.
 *
 * `dekWrapped` / `dekKeyId` are the user's data key, sealed by the master key
 * and stored on their own profile row. Opening it needs the master key, which
 * is deliberately not in the database — but a copy in a Downloads folder
 * turns "an attacker needs the master key too" into "anyone who ever obtains
 * the master key can read every export that was ever taken". It is also of no
 * use to the person downloading their own notes.
 *
 * `aiApiKeyEnc` is their provider key. It is theirs, but a plaintext-adjacent
 * copy on disk is a liability they did not ask for, and it cannot be restored
 * from a file anyway.
 */
export const NEVER_EXPORT = ["dekWrapped", "dekKeyId", "aiApiKeyEnc"] as const;
