import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import {
  DELETE_ONLY_COLLECTIONS,
  EXPORTED_COLLECTIONS,
  NOT_ACCOUNT_DATA,
  PROFILE_COLLECTIONS,
} from "@/lib/account-collections";

const ROOT = process.cwd();

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

// Every collection name the app's own code opens, read from the source itself.
const touched = new Set<string>();
for (const file of [...sources(path.join(ROOT, "lib")), ...sources(path.join(ROOT, "app"))]) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/\.collection(?:<[^>]*>)?\(\s*"([A-Za-z]+)"/g)) touched.add(m[1]);
  for (const m of text.matchAll(/\bCOLLECTION\s*=\s*"([A-Za-z]+)"/g)) touched.add(m[1]);
}

const known = new Set<string>([
  ...EXPORTED_COLLECTIONS,
  ...DELETE_ONLY_COLLECTIONS,
  ...PROFILE_COLLECTIONS,
  ...Object.keys(NOT_ACCOUNT_DATA),
]);

describe("account collections", () => {
  it("finds the collections it is there to police", () => {
    for (const name of ["tasks", "notifications", "calendarFeeds", "mcpAudit"]) {
      expect(touched, name).toContain(name);
    }
  });

  it("accounts for every collection the app touches", () => {
    // A new collection has to be put in a list here, or deleting an account leaves it behind.
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
