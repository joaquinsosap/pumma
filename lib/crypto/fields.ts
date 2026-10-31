// Field-level encryption: the bit that actually touches user content.
//
// Format: "v1:" + base64(iv | tag | ciphertext), AES-256-GCM, fresh 12-byte
// IV per value. The version prefix does two jobs: it makes a future format
// change possible, and with the shape check below it is how a read tells
// ciphertext from a value written before encryption existed. That second job
// is what allows the migration to run against a live database instead of
// during a maintenance window.
//
// No "server-only" import here on purpose: the migration script and the unit
// tests both run outside Next's module graph. The key never reaches this
// module from anywhere but the server anyway.
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "crypto";

const PREFIX = "v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

// Smallest body encryptField can write: the iv and tag of an empty string, as base64.
const MIN_BODY_CHARS = Math.ceil((IV_BYTES + TAG_BYTES) / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Does this value have the shape of our envelope? Text like "v1: ship it" does not, and reads back as typed. */
export function isCiphertext(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return false;
  const body = value.slice(PREFIX.length);
  return (
    body.length >= MIN_BODY_CHARS && body.length % 4 === 0 && BASE64.test(body)
  );
}

export function encryptField(plaintext: string, dek: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const c = createCipheriv("aes-256-gcm", dek, iv);
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

/** For a write: only a value that opens under this key stays as is, so typed text with our shape still gets encrypted. */
export function sealField(value: string, dek: Buffer): string {
  if (isCiphertext(value)) {
    try {
      decryptField(value, dek);
      return value;
    } catch {
      // Has our shape but isn't ours: it is text, encrypted below like any other.
    }
  }
  return encryptField(value, dek);
}

/**
 * Open a field.
 *
 * Anything that is not our ciphertext comes back exactly as it went in —
 * that is the whole zero-downtime story. During the migration a document can
 * legitimately hold an encrypted title and a plaintext description, and both
 * render correctly.
 *
 * A value with our shape that will not open (wrong key, tampered) is a
 * different matter, and this throws: silently showing a user an empty task
 * list because the key changed would be far worse than an error.
 */
export function decryptField(value: string, dek: Buffer): string {
  if (!isCiphertext(value)) return value;

  const buf = Buffer.from(value.slice(PREFIX.length), "base64");
  const d = createDecipheriv("aes-256-gcm", dek, buf.subarray(0, IV_BYTES));
  d.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    d.update(buf.subarray(IV_BYTES + TAG_BYTES)),
    d.final(),
  ]).toString("utf8");
}

/**
 * A deterministic, non-reversible stand-in for a value, so a unique index and
 * an equality lookup still work on something we can no longer read.
 *
 * This exists for one field: `tags.name`. Tags are looked up by name in five
 * places and carry a unique {userId, name} index, and AES-GCM is
 * deliberately non-deterministic — the same name encrypts differently every
 * time. Encrypting the name without this would not error anywhere; it would
 * quietly stop the uniqueness constraint from constraining anything, and let
 * a user end up with two tags called "work".
 *
 * Keyed with the user's own DEK, so the index leaks nothing across accounts:
 * the same tag name in two accounts produces two unrelated keys. Case is
 * folded first because tag names are matched case-insensitively.
 *
 * The usual caveat for blind indexes applies — someone holding the key can
 * confirm a guess ("does this user have a tag called X?"). For tag names that
 * is an acceptable trade for keeping uniqueness.
 */
export function blindIndex(value: string, dek: Buffer): string {
  return createHmac("sha256", dek)
    .update(value.trim().toLowerCase(), "utf8")
    .digest("base64url");
}
