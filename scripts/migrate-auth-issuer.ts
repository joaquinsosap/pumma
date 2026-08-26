/**
 * Backfill `account.issuer`, required by Better Auth 1.7.
 *
 *   npm run db:migrate-auth-issuer -- --check   (report only)
 *   npm run db:migrate-auth-issuer              (write)
 *
 * WHY THIS IS NOT OPTIONAL, AND MUST RUN BEFORE 1.7 SERVES TRAFFIC:
 *
 * 1.7 rekeyed account identity from `accountId` alone to `(issuer, accountId)`.
 * Sign-in now looks for an account matching, all four:
 *
 *     providerId === "credential"
 *     issuer     === "local:credential"
 *     accountId  === user.id
 *     userId     === user.id
 *
 * Rows written by 1.6 have no `issuer` at all, so that lookup misses and every
 * existing account is told its password is wrong. Nothing logs an error: the
 * container is healthy, the database is intact, and the only symptom is that
 * nobody can get in.
 *
 * It is worse than a lockout, too. Password reset calls findCredentialAccount,
 * which filters on the same `issuer`, misses the legacy row, and takes the
 * "no credential account exists" branch, INSERTING a second one. The account
 * then has two credential rows with two different passwords, and which one
 * answers is a question about document order.
 *
 * Live sessions survive either way (they are validated against `session`, not
 * `account`), which is exactly what makes this dangerous: the damage shows up
 * at the next sign-in, not at deploy.
 *
 * Idempotent: it only matches rows with no usable issuer, so a second run
 * writes nothing. `account` is Better Auth's own collection and holds no
 * app-encrypted fields, so it is safe to go at the collection directly.
 */
import { MongoClient, type Document } from "mongodb";
import { loadScriptEnv } from "./_env";
import {
  CREDENTIAL_ISSUER,
  MISSING_ISSUER,
  UNMIGRATED_CREDENTIAL,
} from "../lib/auth/credential-issuer";

async function main() {
  loadScriptEnv();
  const check = process.argv.includes("--check");
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB || undefined);
    const accounts = db.collection<Document>("account");

    const total = await accounts.countDocuments({});
    const stale = await accounts.countDocuments(MISSING_ISSUER);
    console.log(`account rows: ${total}, missing issuer: ${stale}`);
    console.log(`credential issuer: ${CREDENTIAL_ISSUER}`);

    // Anything that is not a credential account needs a different issuer
    // (OAuth identities live in their own "local:oauth:" namespace). PUMMA is
    // email/password only, so hitting this means something arrived that this
    // script was never designed for. Guessing an issuer for it would be worse
    // than stopping: a wrong issuer is indistinguishable from a missing one at
    // sign-in, but much harder to notice afterwards.
    const foreign = await accounts
      .find({ ...MISSING_ISSUER, providerId: { $ne: "credential" } })
      .toArray();
    if (foreign.length) {
      const kinds = [...new Set(foreign.map((r) => String(r.providerId)))];
      console.error(
        `${foreign.length} non-credential rows are missing an issuer ` +
          `(providerId: ${kinds.join(", ")}). This script only knows how to ` +
          `fix credential accounts. Resolve these by hand before signing in.`,
      );
      process.exitCode = 1;
    }

    // Sign-in also requires accountId === user.id. A credential row that
    // disagrees stays unreachable even with a correct issuer, so surface it
    // now rather than letting the backfill look like a fix that worked.
    //
    // Both sides are cast to strings first, and that is not defensive padding:
    // the Mongo adapter writes `userId` as an ObjectId and `accountId` as a
    // string, so comparing them raw is a BSON type comparison that reports a
    // mismatch for every healthy row. A check that fires on all of them is
    // worse than no check, because the run it really needs to interrupt looks
    // exactly like the twenty before it.
    const mismatched = await accounts
      .find({
        providerId: "credential",
        $expr: { $ne: [{ $toString: "$accountId" }, { $toString: "$userId" }] },
      })
      .toArray();
    if (mismatched.length) {
      console.error(
        `${mismatched.length} credential rows have accountId != userId; ` +
          `sign-in will not match them. userIds: ` +
          mismatched.map((r) => String(r.userId)).join(", "),
      );
      process.exitCode = 1;
    }

    const target = await accounts.countDocuments(UNMIGRATED_CREDENTIAL);

    if (!target) {
      console.log("No credential rows need an issuer.");
    } else if (check) {
      console.log(`[check] would set issuer on ${target} credential rows.`);
    } else {
      const res = await accounts.updateMany(
        UNMIGRATED_CREDENTIAL,
        { $set: { issuer: CREDENTIAL_ISSUER } },
      );
      console.log(`Set issuer on ${res.modifiedCount} of ${target} rows.`);

      const left = await accounts.countDocuments(UNMIGRATED_CREDENTIAL);
      if (left) {
        // Loud and non-zero. A half-migrated auth collection means some people
        // can sign in and some cannot, which reads as a flaky login rather
        // than a migration that stopped early.
        console.error(`${left} credential rows still have no issuer.`);
        process.exitCode = 1;
      }
    }

    // Duplicate credential rows per user: either pre-existing, or the
    // fingerprint of a password reset that ran against un-migrated data.
    const dupes = await accounts
      .aggregate([
        { $match: { providerId: "credential" } },
        { $group: { _id: "$userId", n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
      ])
      .toArray();
    if (dupes.length) {
      console.error(
        `${dupes.length} users have more than one credential account: ` +
          dupes.map((d) => `${String(d._id)}(${d.n})`).join(", ") +
          `. Which password answers is undefined; resolve by hand.`,
      );
      process.exitCode = 1;
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
