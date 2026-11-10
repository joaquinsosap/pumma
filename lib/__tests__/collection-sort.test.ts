import { describe, it, expect } from "vitest";
import {
  projectEditedAt,
  reorderWithin,
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
  const p = (over: Partial<Project>): Project => ({
    id: "p",
    userId: "u",
    title: "p",
    description: "",
    color: "oklch(0.6 0.13 155)",
    progress: 0,
    label: "",
    goalId: null,
    tagIds: [],
    lifeArea: "personal",
    order: 0,
    createdAt: "2026-08-01",
    updatedAt: null,
    ...over,
  });
  const work = (over: Partial<Task>): Task => ({
    id: "t",
    userId: "u",
    title: "task",
    description: "",
    subtasks: [],
    tagIds: [],
    priority: "med",
    status: "todo",
    due: null,
    projectId: null,
    goalId: null,
    lifeArea: "personal",
    order: 0,
    createdAt: "2026-08-01",
    completedAt: null,
    timeSpentSec: 0,
    timerStartedAt: null,
    updatedAt: null,
    ticketUrl: null,
    ...over,
  });
  const ids = (list: Project[]) => list.map((x) => x.id);

  it("progress counts the tasks, since the stored number is never kept", () => {
    const got = sortProjects(
      // The stored field says the opposite of the truth on purpose.
      [p({ id: "a", progress: 90 }), p({ id: "b", progress: 0 })],
      "progress",
      false,
      [
        work({ id: "1", projectId: "a", status: "todo" }),
        work({ id: "2", projectId: "b", status: "done" }),
        work({ id: "3", projectId: "b", status: "todo" }),
      ],
    );
    expect(ids(got)).toEqual(["b", "a"]);
  });

  it("alpha ignores case", () => {
    const got = sortProjects(
      [p({ id: "z", title: "zeta" }), p({ id: "a", title: "Alpha" })],
      "alpha",
    );
    expect(ids(got)).toEqual(["a", "z"]);
  });

  it("custom reads the order the drags wrote", () => {
    const got = sortProjects(
      [p({ id: "b", order: 1 }), p({ id: "c", order: 2 }), p({ id: "a", order: 0 })],
      "custom",
    );
    expect(ids(got)).toEqual(["a", "b", "c"]);
  });

  it("custom leaves projects nobody arranged newest first", () => {
    const got = sortProjects(
      [
        p({ id: "old", createdAt: "2026-01-01" }),
        p({ id: "new", createdAt: "2026-09-01" }),
      ],
      "custom",
    );
    expect(ids(got)).toEqual(["new", "old"]);
  });

  it("a project made after the others were arranged comes first", () => {
    // What the stores write: one below the lowest.
    const got = sortProjects(
      [p({ id: "a", order: 0 }), p({ id: "b", order: 1 }), p({ id: "fresh", order: -1 })],
      "custom",
    );
    expect(ids(got)).toEqual(["fresh", "a", "b"]);
  });

  it("last edited follows the latest change to the project or its tasks", () => {
    const projects = [
      p({ id: "renamed", updatedAt: "2026-09-02T10:00:00.000Z" }),
      p({ id: "worked-in", updatedAt: "2026-08-15T10:00:00.000Z" }),
      p({ id: "untouched" }),
    ];
    const tasks = [
      work({
        id: "1",
        projectId: "worked-in",
        updatedAt: "2026-09-03T08:00:00.000Z",
      }),
    ];
    expect(ids(sortProjects(projects, "edited", false, tasks))).toEqual([
      "worked-in",
      "renamed",
      "untouched",
    ]);
    expect(ids(sortProjects(projects, "edited", true, tasks))).toEqual([
      "untouched",
      "renamed",
      "worked-in",
    ]);
  });
});

describe("projectEditedAt", () => {
  const project = { id: "p", createdAt: "2026-08-01", updatedAt: null };

  it("falls back to the day it was made when nothing has touched it", () => {
    expect(projectEditedAt(project, [])).toBe("2026-08-01");
  });

  it("reads a task from before tasks were stamped by the day it was made", () => {
    expect(
      projectEditedAt(project, [
        { projectId: "p", createdAt: "2026-08-20", updatedAt: null },
      ]),
    ).toBe("2026-08-20");
  });

  it("ignores another project's tasks", () => {
    expect(
      projectEditedAt(project, [
        {
          projectId: "other",
          createdAt: "2026-08-01",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      ]),
    ).toBe("2026-08-01");
  });
});

describe("reorderWithin", () => {
  it("takes a full arrangement as it is", () => {
    expect(reorderWithin(["a", "b", "c"], ["c", "a", "b"])).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("rearranges one side of life without moving the other", () => {
    // Personal view shows a, c, e. Work's b and d keep their slots.
    expect(reorderWithin(["a", "b", "c", "d", "e"], ["e", "a", "c"])).toEqual([
      "e",
      "b",
      "a",
      "d",
      "c",
    ]);
  });

  it("drops ids it does not know and ones sent twice", () => {
    expect(reorderWithin(["a", "b"], ["b", "ghost", "b", "a"])).toEqual([
      "b",
      "a",
    ]);
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
