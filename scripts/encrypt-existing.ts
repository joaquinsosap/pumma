/**
 * Backfill: encrypt content written before encryption existed.
 *
 *   npm run db:encrypt            # do it
 *   npm run db:encrypt -- --dry   # say what it would do
 *
 * Safe to re-run and safe to interrupt. Every value is checked for the shape
 * of our envelope first, so a second pass is a no-op and a half-finished run
 * just continues where it stopped.
 *
 * Safe to run while the app is serving, too: reads tolerate plaintext (see
 * lib/crypto/fields.ts), so a document with an encrypted title and a plaintext
 * description renders correctly throughout.
 */
import { MongoClient, type Db } from "mongodb";
import { loadScriptEnv } from "./_env";
import { blindIndex, encryptField, isCiphertext } from "../lib/crypto/fields";
import {
  SPECS,
  specFor,
  type EncryptedCollection,
} from "../lib/crypto/specs";
import { getUserDek } from "../lib/crypto/user-key";

const DRY = process.argv.includes("--dry");

type Counts = { scanned: number; changed: number; fields: number };

async function migrateCollection(
  db: Db,
  name: EncryptedCollection
): Promise<Counts> {
  const spec = specFor(name);
  const c = db.collection(name);
  const counts: Counts = { scanned: 0, changed: 0, fields: 0 };

  // One user at a time: the data key is per user, and doing it this way means
  // one unwrap per user instead of one per document.
  const userIds = (await c.distinct("userId")) as string[];

  for (const userId of userIds) {
    if (!userId) continue;
    let dek: Buffer;
    try {
      dek = await getUserDek(db, userId);
    } catch (err) {
      // A row whose owner no longer exists cannot be encrypted — there is no
      // key to encrypt it under. Report rather than crash; repair-refs is the
      // tool for orphans.
      console.warn(
        `  ! ${name}: skipping ${userId} — ${(err as Error).message}`
      );
      continue;
    }

    const docs = await c.find({ userId }).toArray();
    for (const doc of docs) {
      counts.scanned += 1;
      const $set: Record<string, unknown> = {};

      for (const field of spec.fields) {
        const value = (doc as Record<string, unknown>)[field];
        if (typeof value === "string" && !isCiphertext(value)) {
          $set[field] = encryptField(value, dek);
          counts.fields += 1;
        }
      }

      for (const arr of spec.arrays ?? []) {
        const items = (doc as Record<string, unknown>)[arr.path];
        if (!Array.isArray(items)) continue;
        let touched = false;
        const next = items.map((item) => {
          if (!item || typeof item !== "object") return item;
          const copy = { ...(item as Record<string, unknown>) };
          for (const field of arr.fields) {
            const value = copy[field];
            if (typeof value === "string" && !isCiphertext(value)) {
              copy[field] = encryptField(value, dek);
              touched = true;
              counts.fields += 1;
            }
          }
          return copy;
        });
        if (touched) $set[arr.path] = next;
      }

      // Tags additionally need their searchable stand-in, or the unique index
      // has nothing to constrain and lookups by name stop resolving.
      if (name === "tags") {
        const raw = doc as Record<string, unknown>;
        if (!raw.nameKey && typeof raw.name === "string") {
          // Take it from the plaintext name if this row hasn't been encrypted
          // yet; there is no way back from ciphertext.
          if (!isCiphertext(raw.name)) {
            $set.nameKey = blindIndex(raw.name, dek);
          } else {
            console.warn(
              `  ! tags: ${String(raw._id)} is encrypted but has no nameKey — ` +
                "cannot rebuild it; rename the tag in the app to fix."
            );
          }
        }
      }

      if (!Object.keys($set).length) continue;
      counts.changed += 1;
      if (!DRY) await c.updateOne({ _id: doc._id }, { $set });
    }
  }

  return counts;
}

async function main() {
  loadScriptEnv();
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set (check .env.local).");
  if (!process.env.DATA_ENCRYPTION_KEY) {
    throw new Error(
      "DATA_ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32`, " +
        "put it in the environment, and BACK IT UP — without it this data is unreadable."
    );
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB ?? "pumma");
    console.log(DRY ? "Dry run — nothing will be written.\n" : "Encrypting…\n");

    let totals: Counts = { scanned: 0, changed: 0, fields: 0 };
    for (const name of Object.keys(SPECS) as EncryptedCollection[]) {
      const c = await migrateCollection(db, name);
      console.log(
        `  ${name.padEnd(12)} scanned ${String(c.scanned).padStart(5)}  ` +
          `documents changed ${String(c.changed).padStart(5)}  ` +
          `fields ${String(c.fields).padStart(5)}`
      );
      totals = {
        scanned: totals.scanned + c.scanned,
        changed: totals.changed + c.changed,
        fields: totals.fields + c.fields,
      };
    }

    console.log(
      `\n${DRY ? "Would encrypt" : "Encrypted"} ${totals.fields} field(s) ` +
        `across ${totals.changed} document(s) of ${totals.scanned} scanned.`
    );
    if (!DRY) console.log("Run `npm run db:encryption-audit` to verify.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
