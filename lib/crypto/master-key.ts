// Where the key that unwraps every user's data key comes from.
//
// This is the single most important line in the whole scheme. The promise
// PUMMA makes is "the database alone is not enough to read your content", and
// that is only true while this key lives somewhere the database does not.
//
// Two providers, one interface:
//
//   env  — DATA_ENCRYPTION_KEY, 32 bytes of base64, injected at runtime.
//          Defeats a stolen dump, a stolen backup, a stolen Atlas snapshot.
//          Does not defeat someone who has the server, and leaves no record
//          of use.
//   kms  — an AWS KMS customer master key. Same protection, plus the key
//          never exists in the process at all and every unwrap is a
//          CloudTrail event, so "did anyone read this?" has an answer that
//          isn't somebody's word.
//
// The interface is deliberately tiny (wrap/unwrap of a 32-byte key) so moving
// from one to the other is a config change and not a migration: the wrapped
// blobs carry the id of the key that made them.
// No `server-only` marker here on purpose: the backfill and the audit are
// plain Node scripts and have to be able to reach this. The real barrier is
// lib/mongodb.ts, which every repository goes through and which is
// server-only — nothing on a client path can reach a key from here. The key
// itself is read from a non-NEXT_PUBLIC_ variable, so it is undefined in a
// browser regardless.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

const IV_BYTES = 12; // GCM standard nonce
const TAG_BYTES = 16;

export type MasterKeyProvider = {
  /** Identifies which key made a blob, so a rotation can tell them apart. */
  readonly keyId: string;
  wrap(plainKey: Buffer): Promise<string>;
  unwrap(blob: string): Promise<Buffer>;
};

function envKey(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "DATA_ENCRYPTION_KEY is not set. Generate one with:\n" +
        "  openssl rand -base64 32\n" +
        "Losing it means losing every user's content, so back it up before use.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `DATA_ENCRYPTION_KEY must decode to exactly 32 bytes, got ${key.length}. ` +
        "Generate one with: openssl rand -base64 32",
    );
  }
  return key;
}

/**
 * Local wrapping with a key from the environment.
 *
 * The keyId is a hash of the key, not the key: it lets a wrapped blob say
 * which key opened it without the id itself being a hint about the key.
 */
function envProvider(): MasterKeyProvider {
  const key = envKey();
  const keyId =
    "env:" + createHash("sha256").update(key).digest("hex").slice(0, 12);

  return {
    keyId,
    async wrap(plainKey) {
      const iv = randomBytes(IV_BYTES);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([c.update(plainKey), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
    },
    async unwrap(blob) {
      const buf = Buffer.from(blob, "base64");
      const d = createDecipheriv("aes-256-gcm", key, buf.subarray(0, IV_BYTES));
      d.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      return Buffer.concat([
        d.update(buf.subarray(IV_BYTES + TAG_BYTES)),
        d.final(),
      ]);
    },
  };
}

let cached: MasterKeyProvider | null = null;

/**
 * The configured provider.
 *
 * Resolved lazily and once: reading the environment at module load would make
 * importing this file fail during a build, where the key is legitimately
 * absent.
 */
export function masterKey(): MasterKeyProvider {
  if (cached) return cached;

  const kind = process.env.DATA_ENCRYPTION_PROVIDER ?? "env";
  switch (kind) {
    case "env":
      cached = envProvider();
      return cached;
    case "kms":
      // Deliberately not implemented yet rather than half-implemented: it
      // needs an AWS client, a key id and a scoped IAM role, and a provider
      // that silently fell back to `env` would be the worst possible bug in
      // this file — everything would keep working and the promise would be
      // quietly false. See ENCRYPTION-PLAN.local.md §4.
      throw new Error(
        "DATA_ENCRYPTION_PROVIDER=kms is not implemented yet. Use `env`.",
      );
    default:
      throw new Error(
        `Unknown DATA_ENCRYPTION_PROVIDER "${kind}". Expected "env" or "kms".`,
      );
  }
}

/** Test seam: forget the resolved provider so a new env can be picked up. */
export function resetMasterKeyForTests(): void {
  cached = null;
}
