// Symmetric encryption for secrets we must store but never expose (e.g. a
// user's own Anthropic API key). AES-256-GCM with a key derived from
// BETTER_AUTH_SECRET, so the ciphertext at rest is useless without the running
// server's secret. Server-only — the key must never reach the client bundle.
import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16;

// A stable 32-byte key from the app secret. The dev fallback only ever applies
// in memory mode (no BETTER_AUTH_SECRET), where secrets don't persist anyway.
function key(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  // Hard stop: in mongodb (hosted) mode a missing secret would encrypt every
  // user's API key under a publicly-known constant. lib/env.ts already fails
  // startup on this, but guard here too so no code path can ever fall back to
  // the dev constant with real data. Memory/demo mode has no persistent secrets.
  if (!secret) {
    if (process.env.DATA_SOURCE === "mongodb") {
      throw new Error(
        "BETTER_AUTH_SECRET must be set when DATA_SOURCE=mongodb (secret-at-rest key)",
      );
    }
    return createHash("sha256").update("pumma-dev-insecure-secret").digest();
  }
  return createHash("sha256").update(secret).digest();
}

/** Encrypt a UTF-8 string → base64(iv | tag | ciphertext). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a base64 blob from {@link encryptSecret}. Returns null if it can't
 *  be decrypted (tampered, or encrypted under a different secret). */
export function decryptSecret(blob: string): string | null {
  try {
    const buf = Buffer.from(blob, "base64");
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ct = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}
