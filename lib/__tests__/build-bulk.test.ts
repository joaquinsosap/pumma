import { describe, it, expect } from "vitest";
import {
  buildBulkChangeset,
  checkPatch,
  lookupFrom,
} from "@/lib/ai/build-bulk";
import type { Goal, Habit, Note, Project, Task } from "@/lib/schemas";

const task = (over: Partial<Task> & { id: string }): Task =>
  ({
    userId: "u",
    title: "t",
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
    createdAt: "2026-06-01",
    completedAt: null,
    ...over,
  }) as Task;

const empty = {
  tasks: [] as Task[],
  habits: [] as Habit[],
  goals: [] as Goal[],
  projects: [] as Project[],
  notes: [] as Note[],
};

const TASKS = [
  task({ id: "a", title: "drag tasks onto projects", priority: "med" }),
  task({ id: "b", title: "unify assistant", priority: "low" }),
  task({ id: "c", title: "already high", priority: "high" }),
];

const build = (over: Partial<Parameters<typeof buildBulkChangeset>[0]> = {}) =>
  buildBulkChangeset({
    entity: "task",
    ids: ["a", "b"],
    patch: { priority: "high" },
    remove: false,
    summary: "Set high priority on 2 tasks",
    lookup: lookupFrom({ ...empty, tasks: TASKS }),
    ...over,
  });

describe("ops are built, not generated", () => {
  it("emits one update per row with before read from the row", () => {
    const got = build();
    expect(got.ops).toHaveLength(2);
    expect(got.ops[0]).toEqual({
      op: "update",
      entity: "task",
      id: "a",
      label: "drag tasks onto projects",
      fields: { priority: "high" },
      before: { priority: "med" },
    });
    // The second row's before is its OWN value, not a repeat of the first.
    expect(got.ops[1]).toMatchObject({ before: { priority: "low" } });
  });

  it("is byte-identical across runs", () => {
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  it("skips rows already holding the patched value", () => {
    // An op that changes nothing reads as work about to happen and then does
    // none of it.
    const got = build({ ids: ["a", "b", "c"] });
    expect(got.ops.map((o) => "id" in o && o.id)).toEqual(["a", "b"]);
  });

  it("skips ids that no longer exist rather than emitting a dead op", () => {
    const got = build({ ids: ["a", "ghost"] });
    expect(got.ops).toHaveLength(1);
  });

  it("only carries the keys that actually change", () => {
    const got = build({
      patch: { priority: "high", title: "drag tasks onto projects" },
      ids: ["a"],
    });
    // The title already matches, so it must not appear in the diff.
    expect(Object.keys(got.ops[0].op === "update" ? got.ops[0].fields : {})).toEqual([
      "priority",
    ]);
  });

  it("deletes instead of patching when asked", () => {
    const got = build({ remove: true });
    expect(got.ops.every((o) => o.op === "delete")).toBe(true);
    expect(got.ops[0]).toEqual({
      op: "delete",
      entity: "task",
      id: "a",
      label: "drag tasks onto projects",
    });
  });
});

describe("patch validation", () => {
  it("refuses a field the entity has no use for", () => {
    const res = checkPatch("note", { priority: "high" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("priority");
  });

  it("accepts what the entity does have", () => {
    expect(checkPatch("task", { priority: "high" }).ok).toBe(true);
    expect(checkPatch("habit", { archived: true }).ok).toBe(true);
    expect(checkPatch("note", { title: "x" }).ok).toBe(true);
  });

  it("accepts status on a task, now that the apply path can set one", () => {
    // This used to assert the opposite, and was right to: opFieldsSchema had
    // no status key, so accepting one produced a patch that silently did
    // nothing and left the assistant claiming work it had not done. The
    // vocabulary and the apply path now both carry it (and stamp completedAt
    // with it), so "mark these done" is finally expressible.
    expect(checkPatch("task", { status: "done" }).ok).toBe(true);
    expect(checkPatch("task", { status: "todo" }).ok).toBe(true);
  });

  it("still refuses status on entities that have none", () => {
    // Only tasks have a status. A habit or a note accepting one would be the
    // same silently-ignored patch in a different costume.
    for (const entity of ["habit", "note", "goal", "project"] as const) {
      const res = checkPatch(entity, {
        status: "done",
      } as unknown as Parameters<typeof checkPatch>[1]);
      expect(res.ok).toBe(false);
    }
  });

  it("ignores keys explicitly set to null", () => {
    // null means "not set" throughout the changeset vocabulary.
    expect(checkPatch("note", { priority: null }).ok).toBe(true);
  });
});
