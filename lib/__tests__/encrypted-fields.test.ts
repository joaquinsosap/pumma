import { describe, it, expect } from "vitest";
import { randomBytes } from "crypto";
import { decryptField, encryptField, isCiphertext } from "@/lib/crypto/fields";
import {
  mapContent,
  SPECS,
  specFor,
  type EncryptedCollection,
} from "@/lib/crypto/specs";

// The repository helpers need a database to fetch a key, so these exercise the
// same field-walking rules against the same specs without one. What is being
// checked is the spec itself and the shape of the transformation — that every
// declared field survives a round trip, and that nothing undeclared is touched.

const DEK = randomBytes(32);

const walk = (
  doc: Record<string, unknown>,
  collection: EncryptedCollection,
  fn: (v: string) => string,
) => mapContent(doc, specFor(collection), fn);

const enc = (d: Record<string, unknown>, c: EncryptedCollection) =>
  walk(d, c, (v) => (isCiphertext(v) ? v : encryptField(v, DEK)));
const dec = (d: Record<string, unknown>, c: EncryptedCollection) =>
  walk(d, c, (v) => decryptField(v, DEK));

describe("a task, the worst case", () => {
  const task = {
    _id: "t1",
    userId: "u1",
    title: "Call the accountant about the audit",
    description: "Bring last year's returns",
    subtasks: [
      { id: "s1", title: "find the folder", done: false },
      { id: "s2", title: "scan page 3", done: true },
    ],
    status: "todo",
    priority: "high",
    due: "2026-08-09",
    tagIds: ["tag1"],
    order: 3,
  };

  it("survives a round trip intact", () => {
    expect(dec(enc(task, "tasks"), "tasks")).toEqual(task);
  });

  it("hides the content, including inside subtasks", () => {
    const at = enc(task, "tasks");
    const blob = JSON.stringify(at);
    expect(blob).not.toContain("accountant");
    expect(blob).not.toContain("returns");
    expect(blob).not.toContain("scan page 3");
  });

  it("leaves structure readable, which is the deal", () => {
    // Stated as a test because it is the honest half of the claim: dates,
    // status and ids stay queryable, and that is visible in the database.
    const at = enc(task, "tasks") as typeof task;
    expect(at.due).toBe("2026-08-09");
    expect(at.status).toBe("todo");
    expect(at.priority).toBe("high");
    expect(at.userId).toBe("u1");
    expect(at.tagIds).toEqual(["tag1"]);
    expect(at.order).toBe(3);
    expect(at.subtasks[0].done).toBe(false);
    expect(at.subtasks[0].id).toBe("s1");
  });
});

describe("encrypting twice", () => {
  it("is a no-op, so the backfill can race the live app", () => {
    const once = enc({ title: "x", description: "y" }, "tasks");
    const twice = enc(once, "tasks");
    expect(twice).toEqual(once);
  });
});

describe("half-migrated documents", () => {
  it("read correctly with one field encrypted and one not", () => {
    const mixed = {
      title: encryptField("already done", DEK),
      description: "not yet",
    };
    expect(dec(mixed, "tasks")).toEqual({
      title: "already done",
      description: "not yet",
    });
  });
});

describe("patches", () => {
  it("does not invent fields the patch never mentioned", () => {
    // updateTask sends a partial. Adding an empty description here would
    // wipe whatever the document already held.
    const patch = enc({ title: "renamed" }, "tasks");
    expect(Object.keys(patch)).toEqual(["title"]);
  });

  it("leaves nulls alone", () => {
    expect(enc({ title: null, due: null }, "tasks")).toEqual({
      title: null,
      due: null,
    });
  });
});

describe("every collection in the spec", () => {
  const SAMPLES: Record<EncryptedCollection, Record<string, unknown>> = {
    tasks: { title: "a", description: "b", subtasks: [{ title: "c" }] },
    notes: { title: "a", body: "b" },
    projects: { title: "a", description: "b", label: "c" },
    goals: { title: "a", metricLabel: "b" },
    habits: { name: "a" },
    agenda: { title: "a" },
    lifeWeeks: { note: "a" },
    tags: { name: "a" },
  };

  it("has a sample here, so a new collection can't be added unnoticed", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(SPECS).sort());
  });

  it("round-trips each one, and leaves no declared field readable", () => {
    for (const name of Object.keys(SPECS) as EncryptedCollection[]) {
      const sample = SAMPLES[name];
      expect(dec(enc(sample, name), name), name).toEqual(sample);

      const at = enc(sample, name) as Record<string, unknown>;
      for (const field of specFor(name).fields) {
        expect(isCiphertext(at[field] as string), `${name}.${field}`).toBe(
          true,
        );
      }
    }
  });
});
