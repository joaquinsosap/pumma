import { describe, it, expect } from "vitest";
import {
  sortNotes,
  sortProjects,
  sortTags,
  sortTasks,
} from "@/lib/collection-sort";
import type { Note, Project, Tag, Task } from "@/lib/schemas";

const task = (over: Partial<Task>): Task =>
  ({
    id: over.id ?? "t",
    title: "task",
    priority: "med",
    status: "todo",
    due: null,
    order: 0,
    createdAt: "2026-08-01",
    ...over,
  }) as Task;

describe("sortTasks", () => {
  it("sinks the undated to the bottom of a due sort", () => {
    const got = sortTasks(
      [
        task({ id: "none", due: null }),
        task({ id: "late", due: "2026-09-01" }),
        task({ id: "soon", due: "2026-08-14" }),
      ],
      "due",
    ).map((t) => t.id);
    expect(got).toEqual(["soon", "late", "none"]);
  });

  it("reads custom straight off the order the drags wrote", () => {
    const got = sortTasks(
      [task({ id: "b", order: 1 }), task({ id: "a", order: 0 })],
      "custom",
    ).map((t) => t.id);
    expect(got).toEqual(["a", "b"]);
  });

  it("keeps ties where they were", () => {
    const got = sortTasks(
      [
        task({ id: "x", due: "2026-08-14" }),
        task({ id: "y", due: "2026-08-14" }),
      ],
      "due",
    ).map((t) => t.id);
    expect(got).toEqual(["x", "y"]);
  });

  it("reversed due runs latest first but still sinks the undated", () => {
    const got = sortTasks(
      [
        task({ id: "none", due: null }),
        task({ id: "soon", due: "2026-08-14" }),
        task({ id: "late", due: "2026-09-01" }),
      ],
      "due",
      true,
    ).map((t) => t.id);
    expect(got).toEqual(["late", "soon", "none"]);
  });

  it("reversed priority swaps the bands, not the rows inside them", () => {
    const got = sortTasks(
      [
        task({ id: "h1", priority: "high" }),
        task({ id: "h2", priority: "high" }),
        task({ id: "l", priority: "low" }),
      ],
      "priority",
      true,
    ).map((t) => t.id);
    // low first now, but the two highs keep their order.
    expect(got[0]).toBe("l");
    expect(got.indexOf("h1")).toBeLessThan(got.indexOf("h2"));
  });

  it("reversed ties keep their incoming order too", () => {
    const got = sortTasks(
      [
        task({ id: "x", due: "2026-08-14" }),
        task({ id: "y", due: "2026-08-14" }),
      ],
      "due",
      true,
    ).map((t) => t.id);
    expect(got).toEqual(["x", "y"]);
  });
});

describe("sortProjects", () => {
  const p = (over: Partial<Project>): Project =>
    ({
      id: "p",
      title: "p",
      progress: 0,
      createdAt: "2026-08-01",
      ...over,
    }) as Project;

  it("progress puts the closest-to-done first", () => {
    const got = sortProjects(
      [p({ id: "a", progress: 20 }), p({ id: "b", progress: 80 })],
      "progress",
    ).map((x) => x.id);
    expect(got).toEqual(["b", "a"]);
  });

  it("alpha ignores case", () => {
    const got = sortProjects(
      [p({ id: "z", title: "zeta" }), p({ id: "a", title: "Alpha" })],
      "alpha",
    ).map((x) => x.id);
    expect(got).toEqual(["a", "z"]);
  });
});

describe("sortNotes", () => {
  const n = (over: Partial<Note>): Note =>
    ({
      id: "n",
      title: "n",
      pinned: false,
      createdAt: "2026-08-01",
      updatedAt: "2026-08-01",
      ...over,
    }) as Note;

  it("a pin outranks every ordering", () => {
    const got = sortNotes(
      [
        n({ id: "fresh", updatedAt: "2026-08-13" }),
        n({ id: "pinned-old", pinned: true, updatedAt: "2026-01-01" }),
      ],
      "edited",
    ).map((x) => x.id);
    expect(got).toEqual(["pinned-old", "fresh"]);
  });

  it("a pin outranks a REVERSED ordering too", () => {
    const got = sortNotes(
      [
        n({ id: "fresh", updatedAt: "2026-08-13" }),
        n({ id: "old", updatedAt: "2026-08-01" }),
        n({ id: "pinned", pinned: true, updatedAt: "2026-08-07" }),
      ],
      "edited",
      true,
    ).map((x) => x.id);
    // Oldest touch first now, pin still on top.
    expect(got).toEqual(["pinned", "old", "fresh"]);
  });

  it("edited is newest touch first", () => {
    const got = sortNotes(
      [
        n({ id: "old", updatedAt: "2026-08-01" }),
        n({ id: "new", updatedAt: "2026-08-13" }),
      ],
      "edited",
    ).map((x) => x.id);
    expect(got).toEqual(["new", "old"]);
  });
});

describe("sortTags", () => {
  const t = (over: Partial<Tag>): Tag =>
    ({ id: "t", name: "t", order: 0, createdAt: "2026-08-01", ...over }) as Tag;

  it("usage ranks by the counts it is handed, missing counting as zero", () => {
    const got = sortTags(
      [t({ id: "rare" }), t({ id: "common" })],
      "usage",
      new Map([["common", 9]]),
    ).map((x) => x.id);
    expect(got).toEqual(["common", "rare"]);
  });

  it("custom is the hand-arranged order", () => {
    const got = sortTags(
      [t({ id: "b", order: 5 }), t({ id: "a", order: 1 })],
      "custom",
    ).map((x) => x.id);
    expect(got).toEqual(["a", "b"]);
  });
});
