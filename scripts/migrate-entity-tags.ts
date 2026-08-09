/**
 * Second migration pass: habits, goals and projects become taggable too.
 *
 *   npx tsx scripts/migrate-entity-tags.ts            # dry run, changes nothing
 *   npx tsx scripts/migrate-entity-tags.ts --apply    # writes
 *   npx tsx scripts/migrate-entity-tags.ts --restore <file>
 *
 * Run scripts/migrate-tags-projects.ts first — this one assumes every account
 * already has its "personal" and "work" tags.
 *
 * What it does, in order:
 *   1. Gives every habit, goal and project a tagIds array.
 *   2. Puts a life tag on each of them, derived from the lifeArea they were
 *      stored with (a goal's category wins, since that's the half the goals
 *      page actually showed), then recomputes lifeArea from the tags.
 *   3. Realigns each goal's category with its life tags, so the column and the
 *      tag can't disagree.
 *
 * Re-runnable: every step skips what it has already done.
 */
import { loadScriptEnv } from "./_env";
loadScriptEnv();

import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { MongoClient, type Db } from "mongodb";
import {
  deriveLifeAreaFromTags,
  goalCategoryForLifeArea,
  SPECIAL_LIFE_TAGS,
} from "../lib/life-area-sync";

const APPLY = process.argv.includes("--apply");
const RESTORE = process.argv.indexOf("--restore");
const TOUCHED = ["habits", "goals", "projects"] as const;

type Row = Record<string, unknown> & { _id: string; userId?: string };

async function backup(db: Db): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = resolve(
    process.cwd(),
    `.migration-backups/entity-tags-${stamp}.json`
  );
  const data: Record<string, unknown[]> = {};
  for (const name of TOUCHED) {
    data[name] = await db.collection(name).find({}).toArray();
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

async function restore(db: Db, path: string) {
  const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, Row[]>;
  for (const name of TOUCHED) {
    const rows = data[name] ?? [];
    await db.collection(name).deleteMany({});
    if (rows.length) await db.collection(name).insertMany(rows as never[]);
    console.log(`restored ${name}: ${rows.length}`);
  }
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI missing");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "personal");

  if (RESTORE !== -1) {
    const path = process.argv[RESTORE + 1];
    if (!path) throw new Error("--restore needs a backup file path");
    await restore(db, path);
    await client.close();
    return;
  }

  const plan: string[] = [];
  const note = (line: string) => plan.push(line);

  if (APPLY) {
    const path = await backup(db);
    console.log(`backup written: ${path}\n`);
  }

  const tags = (await db.collection("tags").find({}).toArray()) as unknown as Row[];
  const lifeTagId = (userId: string, name: string) =>
    tags.find(
      (t) => t.userId === userId && String(t.name).toLowerCase() === name
    )?._id as string | undefined;

  // Accounts missing a life tag would silently get nothing attached — say so
  // rather than leaving rows the app then reads as personal by fallback.
  const owners = new Set<string>();
  for (const name of TOUCHED) {
    const rows = (await db
      .collection(name)
      .find({})
      .toArray()) as unknown as Row[];
    rows.forEach((r) => r.userId && owners.add(String(r.userId)));
  }
  const missing = [...owners].filter((u) =>
    SPECIAL_LIFE_TAGS.some((name) => !lifeTagId(u, name))
  );
  if (missing.length) {
    console.error(
      `\n${missing.length} account(s) are missing life tags — run scripts/migrate-tags-projects.ts first:\n  ${missing.join("\n  ")}\n`
    );
    await client.close();
    process.exit(1);
  }

  let tagged = 0;
  let recategorised = 0;

  for (const name of TOUCHED) {
    const rows = (await db
      .collection(name)
      .find({})
      .toArray()) as unknown as Row[];

    for (const row of rows) {
      const userId = String(row.userId ?? "");
      if (!userId) continue;

      const current = Array.isArray(row.tagIds) ? (row.tagIds as string[]) : [];
      const nameById = new Map(tags.map((t) => [String(t._id), String(t.name)]));
      const asTagList = tags.map((t) => ({
        id: String(t._id),
        name: String(t.name),
      }));
      const hasLife = current.some((id) => {
        const n = nameById.get(id)?.toLowerCase();
        return n === "work" || n === "personal";
      });

      // A goal's column is what the app actually showed, so it decides; for
      // everything else the stored lifeArea is all there is.
      const wanted: string[] = [];
      if (!hasLife) {
        const area =
          name === "goals"
            ? // This reads pre-migration rows, so it has to know both
              // spellings of the work column — see scripts/goal-categories.ts.
              row.category === "work" || row.category === "professional"
              ? "work"
              : "personal"
            : row.lifeArea === "work"
              ? "work"
              : row.lifeArea === "both"
                ? "both"
                : "personal";
        const names = area === "both" ? ["personal", "work"] : [area];
        for (const n of names) {
          const id = lifeTagId(userId, n);
          if (id) wanted.push(String(id));
        }
      }

      const tagIds = [...current, ...wanted];
      const lifeArea = deriveLifeAreaFromTags(tagIds, asTagList);
      const patch: Record<string, unknown> = {};

      if (!Array.isArray(row.tagIds) || wanted.length) patch.tagIds = tagIds;
      if (row.lifeArea !== lifeArea) patch.lifeArea = lifeArea;
      if (name === "goals") {
        const category = goalCategoryForLifeArea(lifeArea);
        if (row.category !== category) {
          patch.category = category;
          recategorised++;
        }
      }

      if (!Object.keys(patch).length) continue;
      tagged++;
      if (APPLY) {
        await db
          .collection(name)
          .updateOne({ _id: row._id as never }, { $set: patch });
      }
    }

    note(`${name}: ${rows.length} rows scanned`);
  }

  note(`${tagged} rows updated (tagIds / lifeArea)`);
  note(`${recategorised} goals had their column realigned with their tags`);

  console.log(APPLY ? "APPLIED\n" : "DRY RUN — nothing written\n");
  console.log(plan.join("\n"));
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
