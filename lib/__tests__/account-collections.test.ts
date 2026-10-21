import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import path from "path";
import {
  DELETE_ONLY_COLLECTIONS,
  EXPORTED_COLLECTIONS,
  NOT_ACCOUNT_DATA,
  PROFILE_COLLECTIONS,
} from "@/lib/account-collections";

const ROOT = process.cwd();
const NAME = String.raw`(["'\`])([A-Za-z][A-Za-z0-9_]*)\1`;

/** Collection names in one file, in every form this codebase opens them: a literal, a *COLLECTION/*Collection constant, or a loop over a literal list. */
function collectionNames(text: string): string[] {
  const found: string[] = [];
  const call = new RegExp(String.raw`\.collection\s*(?:<[^()]*>)?\(\s*` + NAME, "g");
  for (const m of text.matchAll(call)) found.push(m[2]);
  const constant = new RegExp(String.raw`\b\w*(?:COLLECTION|Collection)\w*\s*(?::[^=]*)?=\s*` + NAME, "g");
  for (const m of text.matchAll(constant)) found.push(m[2]);
  const loop = /for\s*\(\s*const\s+(\w+)\s+of\s+\[([^\]]*)\]\s*\)[\s\S]{0,400}?\.collection\s*(?:<[^()]*>)?\(\s*(\w+)\s*\)/g;
  for (const m of text.matchAll(loop)) {
    if (m[1] !== m[3]) continue;
    for (const lit of m[2].matchAll(new RegExp(NAME, "g"))) found.push(lit[2]);
  }
  return found;
}

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(t|j|mj)sx?$/.test(entry)) out.push(full);
  }
  return out;
}

const touched = new Set<string>();
for (const dir of ["lib", "app", "scripts"]) {
  for (const file of sources(path.join(ROOT, dir))) {
    for (const name of collectionNames(readFileSync(file, "utf8"))) touched.add(name);
  }
}

const known = new Set<string>([
  ...EXPORTED_COLLECTIONS,
  ...DELETE_ONLY_COLLECTIONS,
  ...PROFILE_COLLECTIONS,
  ...Object.keys(NOT_ACCOUNT_DATA),
]);

describe("the collection scanner", () => {
  it.each([
    ['db.collection("tasks")', "tasks"],
    ["db.collection('notes')", "notes"],
    ["db.collection(`habits`)", "habits"],
    ['db.collection<Doc>("goals")', "goals"],
    ['db.collection<Map<string, Doc>>("agenda")', "agenda"],
    ['const COLLECTION = "mcpAudit";', "mcpAudit"],
    ['const FEED_COLLECTION: string = "calendarFeeds";', "calendarFeeds"],
    ['const feedCollection = "externalEvents";', "externalEvents"],
    ['for (const name of ["oauthAccessToken", "oauthRefreshToken"]) {\n  await db.collection(name).deleteMany(owner);\n}', "oauthRefreshToken"],
    ['db.collection("life_days2")', "life_days2"],
  ])("finds the name in %s", (code, name) => {
    expect(collectionNames(code)).toContain(name);
  });
});

describe("account collections", () => {
  it("finds the collections it is there to police, in lib, app and scripts", () => {
    for (const name of ["tasks", "notifications", "calendarFeeds", "mcpAudit", "oauthRefreshToken"]) {
      expect(touched, name).toContain(name);
    }
  });

  it("accounts for every collection the app opens", () => {
    // A new collection has to be put in a list, or deleting an account leaves it behind.
    for (const name of touched) expect(known.has(name), `${name} is in no list`).toBe(true);
  });

  it("never exports a credential", () => {
    for (const name of DELETE_ONLY_COLLECTIONS) {
      expect(EXPORTED_COLLECTIONS as readonly string[]).not.toContain(name);
    }
  });

  it("deletes sign-in material before anything else", () => {
    expect(DELETE_ONLY_COLLECTIONS.slice(0, 2)).toEqual(["session", "account"]);
  });
});
