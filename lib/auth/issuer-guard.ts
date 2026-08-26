// Boot-time check for the one upgrade failure that gives no other warning.
import "server-only";
import { getDb } from "@/lib/mongodb";
import { UNMIGRATED_CREDENTIAL } from "@/lib/auth/credential-issuer";

/**
 * Shout if any credential account predates the Better Auth 1.7 `issuer` field.
 *
 * Sign-in matches on `(providerId, issuer, accountId)`, so a row written by
 * 1.6 is never found and the attempt is refused with "User not found". Every
 * other signal stays green: the container is healthy, Mongo is up, the data is
 * all still there, and the error points at the users collection rather than at
 * the account collection where the actual problem is.
 *
 * Existing sessions keep working (they are checked against `session`), so this
 * does not necessarily show up at deploy. It shows up hours later, as people
 * are told their account does not exist.
 *
 * Fix: `npm run db:migrate-auth-issuer`.
 *
 * This warns rather than throwing. By the time it runs, anyone with a live
 * session is being served normally, and refusing to boot would take them down
 * too in order to protest a problem that only affects signing in.
 */
export async function warnOnUnmigratedAccounts(): Promise<void> {
  if (process.env.DATA_SOURCE !== "mongodb") return;
  try {
    const db = await getDb();
    const stale = await db
      .collection("account")
      .countDocuments(UNMIGRATED_CREDENTIAL, { limit: 1 });
    if (stale > 0) {
      console.error(
        "\n[auth] SIGN-IN IS BROKEN FOR EXISTING ACCOUNTS.\n" +
          "[auth] Credential rows are missing the `issuer` field that Better Auth 1.7\n" +
          "[auth] requires, so the lookup misses and a correct password is refused.\n" +
          "[auth] Users see \"Invalid email or password\"; the log says \"User not found\".\n" +
          "[auth] Neither mentions the account collection, where the problem actually is.\n" +
          "[auth] Live sessions keep working, so nothing else will look wrong.\n" +
          "[auth] Fix: npm run db:migrate-auth-issuer\n",
      );
    }
  } catch {
    // A database that cannot be reached at boot is already reported elsewhere,
    // and this check must never be the reason a container fails to start.
  }
}
