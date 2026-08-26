// The Better Auth 1.7 upgrade rekeyed accounts on (issuer, accountId). Rows
// written before it have no issuer, sign-in cannot find them, and the refusal
// it returns is "User not found" -- so the symptom looks like missing users
// rather than a missing field, and nothing else in the system reports a fault.
//
// These pin the one predicate that decides which rows are affected. It is
// shared by the migration and by the boot guard, and the interesting part is
// not "absent" but the two spellings that are easy to forget: an explicit null
// and an empty string both fail the sign-in match exactly like absence does.
import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_ISSUER,
  MISSING_ISSUER,
  UNMIGRATED_CREDENTIAL,
  needsIssuerBackfill,
} from "@/lib/auth/credential-issuer";

describe("credential issuer", () => {
  it("matches what Better Auth writes on sign-up", () => {
    // Verified against a real 1.7.1 sign-up against a real mongod. If the
    // library ever changes the format, this is the line that should fail
    // rather than sign-in in production.
    expect(CREDENTIAL_ISSUER).toBe("local:credential");
  });

  it("treats absent, null and blank as needing the backfill", () => {
    const base = { providerId: "credential" };
    expect(needsIssuerBackfill({ ...base })).toBe(true);
    expect(needsIssuerBackfill({ ...base, issuer: null })).toBe(true);
    expect(needsIssuerBackfill({ ...base, issuer: "" })).toBe(true);
  });

  it("leaves already-migrated rows alone", () => {
    expect(
      needsIssuerBackfill({ providerId: "credential", issuer: CREDENTIAL_ISSUER }),
    ).toBe(false);
  });

  it("never claims a non-credential account", () => {
    // OAuth identities live in a separate issuer namespace; guessing one for
    // them would write a value that is wrong in a way nobody can see.
    expect(needsIssuerBackfill({ providerId: "google" })).toBe(false);
    expect(needsIssuerBackfill({ providerId: "google", issuer: null })).toBe(false);
  });

  it("keeps the query filter and the predicate in agreement", () => {
    // The migration runs the filter in Mongo and the test runs the predicate
    // here; they are only useful if they describe the same set of rows.
    expect(UNMIGRATED_CREDENTIAL.providerId).toBe("credential");
    expect(UNMIGRATED_CREDENTIAL.$or).toEqual(MISSING_ISSUER.$or);
    expect(MISSING_ISSUER.$or).toEqual([
      { issuer: { $exists: false } },
      { issuer: null },
      { issuer: "" },
    ]);
  });
});
