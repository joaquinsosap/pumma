import { describe, it, expect } from "vitest";
import { randomBytes } from "crypto";
import {
  blindIndex,
  decryptField,
  encryptField,
  isCiphertext,
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
  it("marks its own output", () => {
    expect(isCiphertext(encryptField("x", KEY))).toBe(true);
  });

  it("leaves values written before encryption alone", () => {
    // The migration runs against a live database, so a read has to cope with
    // a document that is half converted.
    expect(decryptField("a plain old title", KEY)).toBe("a plain old title");
    expect(isCiphertext("a plain old title")).toBe(false);
  });

  it("is not fooled by a user typing the prefix", () => {
    const typed = "v1:my great idea";
    expect(isCiphertext(typed)).toBe(true);
    // It claims to be ours and cannot be opened — which must not be silent.
    expect(() => decryptField(typed, KEY)).toThrow();
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

  it("throws on a truncated payload", () => {
    expect(() =>
      decryptField("v1:" + Buffer.from("short").toString("base64"), KEY),
    ).toThrow();
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
