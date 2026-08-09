// The one place that knows which fields are private.
//
// Everything above this line — actions, pages, the AI snapshot — sees ordinary
// plaintext objects and has no idea any of this is happening. Everything below
// it sees ciphertext. Keeping the seam here, rather than sprinkling
// encrypt/decrypt calls up the stack, is what makes the guarantee checkable:
// if a field is in a spec below, it is encrypted at rest, and there is exactly
// one file to read to know that.
import { getDb } from "@/lib/mongodb";
import {
  blindIndex,
  decryptField,
  encryptField,
  isCiphertext,
} from "@/lib/crypto/fields";
import { getUserDek } from "@/lib/crypto/user-key";
import {
  mapContent,
  SPECS,
  specFor,
  type EncryptedCollection,
} from "@/lib/crypto/specs";

// Re-exported so callers have one import for "the encryption boundary".
export { SPECS, specFor, type EncryptedCollection };
export type { Spec } from "@/lib/crypto/specs";

async function dekFor(userId: string): Promise<Buffer> {
  const db = await getDb();
  return getUserDek(db, userId);
}

/**
 * Encrypt a document (or a `$set` patch) on its way into Mongo.
 *
 * Already-encrypted values are left alone, so running this twice is safe —
 * which matters because the migration and the live app write through the same
 * path while a backfill is in progress.
 */
export async function encryptFor<T extends object>(
  collection: EncryptedCollection,
  userId: string,
  doc: T,
): Promise<T> {
  const dek = await dekFor(userId);
  return mapContent(doc as Record<string, unknown>, SPECS[collection], (v) =>
    isCiphertext(v) ? v : encryptField(v, dek),
  ) as T;
}

/**
 * Decrypt a document on its way out.
 *
 * Values written before encryption existed pass through untouched, so a
 * half-migrated document renders correctly and the backfill never needs a
 * maintenance window.
 */
export async function decryptFor<T extends object>(
  collection: EncryptedCollection,
  userId: string,
  doc: T,
): Promise<T> {
  const dek = await dekFor(userId);
  return mapContent(doc as Record<string, unknown>, SPECS[collection], (v) =>
    decryptField(v, dek),
  ) as T;
}

/**
 * The searchable stand-in for a value we can no longer read.
 *
 * Only tag names need this — see the note on `blindIndex` for why encrypting
 * them without it would quietly break uniqueness rather than fail loudly.
 */
export async function blindIndexFor(
  userId: string,
  value: string,
): Promise<string> {
  return blindIndex(value, await dekFor(userId));
}

/**
 * Decrypt many documents with one key lookup.
 *
 * All callers here fetch one user's rows at a time, so this is the common
 * case by far and the naive version would unwrap the key once per document.
 */
export async function decryptAllFor<T extends object>(
  collection: EncryptedCollection,
  userId: string,
  docs: T[],
): Promise<T[]> {
  if (!docs.length) return docs;
  const dek = await dekFor(userId);
  const spec = SPECS[collection];
  return docs.map(
    (doc) =>
      mapContent(doc as Record<string, unknown>, spec, (v) =>
        decryptField(v, dek),
      ) as T,
  );
}
