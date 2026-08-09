/**
 * Rewrite the one word goals disagreed with the rest of the app about.
 *
 *   npm run db:goal-categories
 *
 * Goals stored `category: "professional"` where every other entity said
 * "work". Reads coerce the old value (see `goalSchema` in lib/schemas), so
 * this is not urgent — but until it runs, a goal written back by the app
 * flips to "work" while its untouched neighbours stay "professional", and
 * anything querying Mongo directly has to know both spellings.
 *
 * Idempotent: it only ever matches the legacy value, so running it twice
 * updates nothing the second time. `category` is not an encrypted field, so
 * this can go straight at the collection.
 */
import { MongoClient } from "mongodb";
import { loadScriptEnv } from "./_env";

async function main() {
  loadScriptEnv();
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB || undefined);
    const goals = db.collection("goals");

    const before = await goals.countDocuments({ category: "professional" });
    if (!before) {
      console.log("No goals still say 'professional' — nothing to do.");
      return;
    }

    const res = await goals.updateMany(
      { category: "professional" },
      { $set: { category: "work" } }
    );
    console.log(`Rewrote ${res.modifiedCount} of ${before} goal categories.`);

    const left = await goals.countDocuments({ category: "professional" });
    if (left) {
      // Loud, and non-zero: a partial rewrite is worse than none, because the
      // two spellings then coexist with nothing marking which is which.
      console.error(`${left} goals still say 'professional'.`);
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
