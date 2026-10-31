import { describe, it, expect } from "vitest";
import { randomBytes } from "crypto";
import {
  blindIndex,
  decryptField,
  encryptField,
  isCiphertext,
  sealField,
} from "@/lib/crypto/fields";

const KEY = randomBytes(32);
const OTHER = randomBytes(32);

describe("round trip", () => {
  const CASES = [
    "Ship the deck",
    "",
    " leading and trailing ",
    "unicode: café, 日本語, 🙂",
    "a".repeat(10_000),
    "looks like ours but isn't: v1:not-base64",
    '{"json":"in a field"}',
  ];

  it("returns exactly what went in", () => {
    for (const text of CASES) {
      expect(decryptField(encryptField(text, KEY), KEY), text).toBe(text);
    }
  });

  it("produces different ciphertext every time", () => {
    // A fresh IV per value. Without this, identical titles would be visibly
    // identical at rest, which leaks more than it looks like it does.
    const a = encryptField("standup", KEY);
    const b = encryptField("standup", KEY);
    expect(a).not.toBe(b);
    expect(decryptField(a, KEY)).toBe(decryptField(b, KEY));
  });
});

describe("telling ciphertext from plaintext", () => {
  it("marks its own output, at every length", () => {
    for (let n = 0; n < 64; n++) {
      expect(isCiphertext(encryptField("x".repeat(n), KEY)), `${n}`).toBe(true);
    }
  });

  it("leaves values written before encryption alone", () => {
    // The migration runs against a live database, so a read has to cope with
    // a document that is half converted.
    expect(decryptField("a plain old title", KEY)).toBe("a plain old title");
    expect(isCiphertext("a plain old title")).toBe(false);
  });

  it("reads text a person typed with the prefix as that text", () => {
    // One such row used to fail every list read for the account.
    for (const typed of [
      "v1:",
      "v1: ship it",
      "v1:beta",
      "v1:mvp",
      "v1:my great idea",
      // Valid base64, but shorter than any envelope.
      "v1:roadmaps",
      "v1:" + "a".repeat(36),
      "v1:" + "a".repeat(39),
      "v1:" + "a".repeat(41),
      "v1:" + "A".repeat(37) + "===",
      "v1:" + "a b".repeat(20),
      "v1:" + "=".repeat(40),
    ]) {
      expect(isCiphertext(typed), typed).toBe(false);
      expect(decryptField(typed, KEY), typed).toBe(typed);
    }
  });
});

describe("sealing a value on its way into storage", () => {
  const TYPED = [
    "v1: ship it",
    "v1:beta",
    "v1:mvp",
    "v1:",
    // Exactly the shape of our envelope, typed by hand.
    "v1:" + "A".repeat(40),
    "v1:" + Buffer.from("x".repeat(60)).toString("base64"),
  ];

  it("encrypts plain text", () => {
    const sealed = sealField("a plain old title", KEY);
    expect(sealed).not.toContain("plain");
    expect(decryptField(sealed, KEY)).toBe("a plain old title");
  });

  it("stores typed text as real ciphertext that reads back as typed", () => {
    for (const typed of TYPED) {
      const sealed = sealField(typed, KEY);
      expect(sealed, typed).not.toBe(typed);
      expect(isCiphertext(sealed), typed).toBe(true);
      expect(decryptField(sealed, KEY), typed).toBe(typed);
    }
  });

  it("does not encrypt real ciphertext twice, so a second pass is safe", () => {
    const ct = encryptField("private", KEY);
    expect(sealField(ct, KEY)).toBe(ct);
    for (const typed of TYPED) {
      const once = sealField(typed, KEY);
      expect(sealField(once, KEY), typed).toBe(once);
    }
  });
});

describe("refusing to open what it shouldn't", () => {
  it("throws on the wrong key rather than returning nonsense", () => {
    const ct = encryptField("private", KEY);
    expect(() => decryptField(ct, OTHER)).toThrow();
  });

  it("throws on a tampered payload", () => {
    // GCM authenticates: flipping a byte has to be caught, not decoded.
    const ct = encryptField("private", KEY);
    const raw = Buffer.from(ct.slice(3), "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => decryptField("v1:" + raw.toString("base64"), KEY)).toThrow();
  });

  it("throws on a payload cut short that still has the shape", () => {
    const ct = encryptField("a private title long enough to cut", KEY);
    const cut = ct.slice(0, -4);
    expect(isCiphertext(cut)).toBe(true);
    expect(() => decryptField(cut, KEY)).toThrow();
  });

  it("would rather error than show an empty account", () => {
    // Stated as a test because it is a product decision, not a detail: if the
    // key is wrong, the honest outcome is a loud failure. Swallowing it would
    // render every task list empty and look like data loss.
    expect(() => decryptField(encryptField("x", KEY), OTHER)).toThrow();
  });
});

describe("blind index for tag names", () => {
  it("is stable, so a lookup by name can find the row", () => {
    expect(blindIndex("work", KEY)).toBe(blindIndex("work", KEY));
  });

  it("folds case and surrounding space, the way tag matching does", () => {
    expect(blindIndex("Work", KEY)).toBe(blindIndex("  work ", KEY));
  });

  it("separates different names", () => {
    expect(blindIndex("work", KEY)).not.toBe(blindIndex("home", KEY));
  });

  it("gives the same name a different key in a different account", () => {
    // Otherwise the index would be a cross-account dictionary: spot the same
    // hash in two users and you know they share a tag name.
    expect(blindIndex("work", KEY)).not.toBe(blindIndex("work", OTHER));
  });

  it("does not contain the value it stands for", () => {
    expect(blindIndex("job-hunting", KEY)).not.toContain("job");
  });
});
