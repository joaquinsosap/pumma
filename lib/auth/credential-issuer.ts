/**
 * One definition of "this credential account predates Better Auth 1.7".
 *
 * Three places need to agree on it: the migration that fixes the rows, the
 * boot guard that shouts when they are still there, and the test that pins
 * both. They were briefly three copies of the same `$or`, which is exactly the
 * kind of duplication that survives until one copy learns about `issuer: ""`
 * and the others do not.
 *
 * No "server-only" here on purpose: the standalone migration script imports it
 * too, and that runs under tsx rather than Next.
 */
import { createLocalAccountIssuer } from "@better-auth/core/db";

/**
 * The issuer Better Auth writes for email/password accounts.
 *
 * Asked of the library rather than written out as "local:credential", so a
 * change to the format turns into a different value here instead of a value
 * that silently stops matching what sign-in looks for.
 */
export const CREDENTIAL_ISSUER = createLocalAccountIssuer("credential");

/**
 * Absent, null and empty all fail the sign-in match, so all three count.
 *
 * Left mutable rather than `as const`: these go straight into the driver's
 * `Filter<Document>`, which will not take a readonly `$or`.
 */
export const MISSING_ISSUER = {
  $or: [{ issuer: { $exists: false } }, { issuer: null }, { issuer: "" }],
};

/** Credential rows that sign-in can no longer find. */
export const UNMIGRATED_CREDENTIAL = {
  providerId: "credential",
  ...MISSING_ISSUER,
};

/** Whether one account row still needs the backfill. */
export function needsIssuerBackfill(row: {
  providerId?: unknown;
  issuer?: unknown;
}): boolean {
  if (row.providerId !== "credential") return false;
  return row.issuer === undefined || row.issuer === null || row.issuer === "";
}
