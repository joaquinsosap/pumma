import { describe, it, expect } from "vitest";
import {
  partitionStarters,
  starterHash,
  type StarterEntry,
} from "@/lib/starter";

const task = () => ({
  title: "Try moving me to Doing",
  description: "",
  priority: "med",
  due: "2026-08-14",
  tagIds: ["t1", "t2"],
  subtasks: [{ id: "s1", title: "a step", done: false }],
  status: "todo",
  completedAt: null,
  order: 3,
});

const entry = (over: Partial<StarterEntry> = {}): StarterEntry => ({
  kind: "task",
  id: "1",
  hash: starterHash("task", task()),
  ...over,
});

describe("starterHash", () => {
  it("ignores using the item: ticking it off, reordering, completing", () => {
    const used = {
      ...task(),
      status: "done",
      completedAt: "2026-08-13",
      order: 99,
      subtasks: [{ id: "s1", title: "a step", done: true }],
    };
    expect(starterHash("task", used)).toBe(starterHash("task", task()));
  });

  it("notices authorship: the words, the date, the priority", () => {
    for (const change of [
      { title: "my own thing" },
      { description: "notes of my own" },
      { due: "2026-12-01" },
      { priority: "high" },
      { subtasks: [{ id: "s1", title: "a different step", done: false }] },
    ]) {
      expect(starterHash("task", { ...task(), ...change })).not.toBe(
        starterHash("task", task()),
      );
    }
  });

  it("treats tag order as meaningless and tag membership as meaningful", () => {
    expect(starterHash("task", { ...task(), tagIds: ["t2", "t1"] })).toBe(
      starterHash("task", task()),
    );
    expect(starterHash("task", { ...task(), tagIds: ["t1"] })).not.toBe(
      starterHash("task", task()),
    );
  });

  it("separates kinds, so ids cannot collide across collections", () => {
    const shape = { title: "x", body: "x", tagIds: [] };
    expect(starterHash("note", shape)).not.toBe(starterHash("task", shape));
  });
});

describe("partitionStarters", () => {
  it("removes the untouched, keeps the rewritten, shrugs at the deleted", () => {
    const untouched = entry({ id: "keep-me-not" });
    const rewritten = entry({ id: "mine-now" });
    const deleted = entry({ id: "already-gone" });

    const current = new Map<string, Record<string, unknown>>([
      ["task:keep-me-not", task()],
      ["task:mine-now", { ...task(), title: "actually mine" }],
    ]);

    const { removable, adopted, gone } = partitionStarters(
      [untouched, rewritten, deleted],
      current,
    );
    expect(removable.map((e) => e.id)).toEqual(["keep-me-not"]);
    expect(adopted.map((e) => e.id)).toEqual(["mine-now"]);
    expect(gone.map((e) => e.id)).toEqual(["already-gone"]);
  });

  it("never reports anything the account did not receive from us", () => {
    const current = new Map<string, Record<string, unknown>>([
      ["task:not-a-starter", task()],
    ]);
    const { removable } = partitionStarters([], current);
    expect(removable).toEqual([]);
  });
});

describe("the starter bundle round-trips through its own manifest", () => {
  it("is entirely removable the moment it is planted", async () => {
    // The bug this catches: a fingerprint taken over a field the document
    // does not actually have, or a shape that drifts from the schema. Either
    // way the hashes stop matching and the clear button silently does nothing.
    const { buildStarterContent } = await import("@/lib/starter-content");
    const bundle = buildStarterContent("u1", ["tag-personal"]);

    const current = new Map<string, Record<string, unknown>>();
    for (const [kind, docs] of [
      ["task", bundle.tasks],
      ["note", bundle.notes],
      ["habit", bundle.habits],
      ["goal", bundle.goals],
      ["project", bundle.projects],
    ] as const) {
      for (const doc of docs) {
        current.set(
          `${kind}:${doc._id}`,
          doc as unknown as Record<string, unknown>,
        );
      }
    }

    const { removable, adopted, gone } = partitionStarters(
      bundle.manifest,
      current,
    );
    expect(bundle.manifest.length).toBe(current.size);
    expect(removable.length).toBe(bundle.manifest.length);
    expect(adopted).toEqual([]);
    expect(gone).toEqual([]);
  });

  it("stops offering an item the moment its words change", async () => {
    const { buildStarterContent } = await import("@/lib/starter-content");
    const bundle = buildStarterContent("u1", []);
    const first = bundle.tasks[0];

    const current = new Map<string, Record<string, unknown>>([
      [
        `task:${first._id}`,
        { ...first, title: "my own words" } as unknown as Record<
          string,
          unknown
        >,
      ],
    ]);
    const { removable, adopted } = partitionStarters(
      bundle.manifest.filter((e) => e.id === first._id),
      current,
    );
    expect(removable).toEqual([]);
    expect(adopted).toHaveLength(1);
  });
});
