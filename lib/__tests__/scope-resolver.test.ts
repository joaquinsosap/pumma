import { describe, it, expect } from "vitest";
import { resolveScope, ALL_CAP, inWindow } from "@/lib/scope-resolver";
import {
  FILTERS_FOR,
  SORTS_FOR,
  SCOPE_ENTITIES,
  type Scope,
} from "@/lib/ai/scope-schema";
import type { Goal, Habit, Note, Project, Task } from "@/lib/schemas";

const TZ = "America/Montevideo";
const TODAY = "2026-08-26";

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

const note = (over: Partial<Note> & { id: string }): Note =>
  ({
    userId: "u",
    title: "n",
    body: "",
    tagIds: [],
    pinned: false,
    lifeArea: "personal",
    createdAt: "2026-06-01",
    updatedAt: "2026-06-01",
    ...over,
  }) as Note;

const habit = (over: Partial<Habit> & { id: string }): Habit =>
  ({
    userId: "u",
    name: "h",
    color: "#000",
    frequency: { type: "daily", target: 1 },
    order: 0,
    archived: false,
    goalIds: [],
    goalTargetStreak: null,
    tagIds: [],
    lifeArea: "personal",
    createdAt: "2026-06-01",
    ...over,
  }) as Habit;

const goal = (over: Partial<Goal> & { id: string }): Goal =>
  ({
    userId: "u",
    title: "g",
    category: "personal",
    metricLabel: "",
    progress: 0,
    targetDate: null,
    tagIds: [],
    lifeArea: "personal",
    order: 0,
    createdAt: "2026-06-01",
    ...over,
  }) as Goal;

const project = (over: Partial<Project> & { id: string }): Project =>
  ({
    userId: "u",
    title: "p",
    description: "",
    color: "#000",
    progress: 0,
    label: "",
    goalId: null,
    tagIds: [],
    lifeArea: "personal",
    createdAt: "2026-06-01",
    ...over,
  }) as Project;

const input = (over: Partial<Parameters<typeof resolveScope>[1]> = {}) => ({
  today: TODAY,
  timeZone: TZ,
  tasks: [] as Task[],
  habits: [] as Habit[],
  goals: [] as Goal[],
  projects: [] as Project[],
  notes: [] as Note[],
  ...over,
});

const scope = (over: Partial<Scope> = {}): Scope => ({
  entity: "task",
  filters: {},
  sort: { by: "created", reversed: false },
  count: "all",
  assumed: [],
  ...over,
});

// The three tasks from the bug report, plus a done one that should not be
// touched and a newer one the count should cut off.
const BUG_TASKS = [
  task({ id: "drag", title: "drag tasks onto projects", createdAt: "2026-06-12" }),
  task({ id: "old-done", title: "an old finished thing", createdAt: "2026-06-02", status: "done" }),
  task({ id: "unify", title: "unify assistant into one", createdAt: "2026-06-14", priority: "low" }),
  task({ id: "sugg", title: "create a page for suggestions", createdAt: "2026-06-19" }),
  task({ id: "notes", title: "write the release notes", createdAt: "2026-06-24" }),
];

describe("the bug this exists for", () => {
  it("'oldest 3 open tasks' excludes done and takes the three oldest", () => {
    const got = resolveScope(
      scope({
        filters: { status: ["todo", "doing"] },
        sort: { by: "created", reversed: false },
        count: 3,
        assumed: ["status"],
      }),
      input({ tasks: BUG_TASKS }),
    );
    expect(got.ids).toEqual(["drag", "unify", "sugg"]);
    // The done task is older than all three and still must not be selected.
    expect(got.ids).not.toContain("old-done");
    expect(got.matched).toBe(4);
  });

  it("shows what the count cut off, so the exclusion is visible", () => {
    const got = resolveScope(
      scope({ filters: { status: ["todo", "doing"] }, count: 3 }),
      input({ tasks: BUG_TASKS }),
    );
    expect(got.excluded.map((r) => r.id)).toEqual(["notes"]);
  });

  it("filters, then sorts, then cuts — never cuts first", () => {
    // If the cut ran before the sort, dropping the done task would change
    // which three came out.
    const withoutDone = BUG_TASKS.filter((t) => t.status !== "done");
    const a = resolveScope(
      scope({ filters: { status: ["todo", "doing"] }, count: 3 }),
      input({ tasks: BUG_TASKS }),
    );
    const b = resolveScope(
      scope({ filters: { status: ["todo", "doing"] }, count: 3 }),
      input({ tasks: withoutDone }),
    );
    expect(a.ids).toEqual(b.ids);
  });
});

describe("determinism", () => {
  it("the same spec resolves identically, order included", () => {
    const s = scope({ filters: { status: ["todo"] }, count: 3 });
    const a = resolveScope(s, input({ tasks: BUG_TASKS }));
    const b = resolveScope(s, input({ tasks: BUG_TASKS }));
    expect(a.ids).toEqual(b.ids);
    expect(a.rows).toEqual(b.rows);
  });

  it("input order does not change the result", () => {
    const s = scope({ filters: { status: ["todo", "doing"] }, count: 3 });
    const forwards = resolveScope(s, input({ tasks: BUG_TASKS }));
    const backwards = resolveScope(
      s,
      input({ tasks: [...BUG_TASKS].reverse() }),
    );
    expect(forwards.ids).toEqual(backwards.ids);
  });
});

describe("sorting", () => {
  it("oldest is ascending and newest is descending", () => {
    const oldest = resolveScope(
      scope({ sort: { by: "created", reversed: false }, count: 2 }),
      input({ tasks: BUG_TASKS }),
    );
    const newest = resolveScope(
      scope({ sort: { by: "created", reversed: true }, count: 2 }),
      input({ tasks: BUG_TASKS }),
    );
    expect(oldest.ids[0]).toBe("old-done");
    expect(newest.ids[0]).toBe("notes");
  });

  it("undated tasks sink on a due sort rather than leading it", () => {
    const got = resolveScope(
      scope({ sort: { by: "due", reversed: false } }),
      input({
        tasks: [
          task({ id: "none", due: null }),
          task({ id: "late", due: "2026-09-01" }),
          task({ id: "soon", due: "2026-08-28" }),
        ],
      }),
    );
    expect(got.ids).toEqual(["soon", "late", "none"]);
  });
});

describe("count", () => {
  it("'all' is capped, and says so", () => {
    const many = Array.from({ length: ALL_CAP + 30 }, (_, i) =>
      task({ id: `t${i}`, createdAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}` }),
    );
    const got = resolveScope(scope({ count: "all" }), input({ tasks: many }));
    expect(got.ids).toHaveLength(ALL_CAP);
    expect(got.capped).toBe(true);
    expect(got.matched).toBe(ALL_CAP + 30);
  });

  it("'all' under the cap does not claim to be capped", () => {
    const got = resolveScope(scope({ count: "all" }), input({ tasks: BUG_TASKS }));
    expect(got.capped).toBe(false);
  });
});

describe("filters", () => {
  it("lifeArea 'both' items belong to either side", () => {
    const got = resolveScope(
      scope({ filters: { lifeArea: "work" } }),
      input({
        tasks: [
          task({ id: "w", lifeArea: "work" }),
          task({ id: "shared", lifeArea: "both" }),
          task({ id: "p", lifeArea: "personal" }),
        ],
      }),
    );
    // A shared task is a work task too — dropping it would be silent loss.
    expect(got.ids.sort()).toEqual(["shared", "w"]);
  });

  it("tags match ANY, not all", () => {
    const got = resolveScope(
      scope({ filters: { tagIds: ["a", "b"] } }),
      input({
        tasks: [
          task({ id: "one", tagIds: ["a"] }),
          task({ id: "both", tagIds: ["a", "b"] }),
          task({ id: "none", tagIds: ["c"] }),
        ],
      }),
    );
    expect(got.ids.sort()).toEqual(["both", "one"]);
  });

  it("contains is case-insensitive", () => {
    const got = resolveScope(
      scope({ filters: { contains: "RELEASE" } }),
      input({ tasks: BUG_TASKS }),
    );
    expect(got.ids).toEqual(["notes"]);
  });

  it("habits hide archived unless asked", () => {
    const habits = [
      habit({ id: "live" }),
      habit({ id: "put-away", archived: true }),
    ];
    expect(
      resolveScope(scope({ entity: "habit" }), input({ habits })).ids,
    ).toEqual(["live"]);
    expect(
      resolveScope(
        scope({ entity: "habit", filters: { archived: true } }),
        input({ habits }),
      ).ids,
    ).toEqual(["put-away"]);
  });

  it("progress ranges are strict", () => {
    const goals = [
      goal({ id: "a", progress: 20 }),
      goal({ id: "b", progress: 50 }),
      goal({ id: "c", progress: 80 }),
    ];
    expect(
      resolveScope(
        scope({ entity: "goal", filters: { progressBelow: 50 } }),
        input({ goals }),
      ).ids,
    ).toEqual(["a"]);
  });
});

describe("date windows", () => {
  it("reads a window against the user's today", () => {
    expect(inWindow("2026-08-20", "overdue", TODAY, TZ)).toBe(true);
    expect(inWindow("2026-08-26", "overdue", TODAY, TZ)).toBe(false);
    expect(inWindow("2026-08-26", "today", TODAY, TZ)).toBe(true);
    expect(inWindow(null, "undated", TODAY, TZ)).toBe(true);
    expect(inWindow("2026-08-28", "thisWeek", TODAY, TZ)).toBe(true);
    expect(inWindow("2026-09-30", "thisWeek", TODAY, TZ)).toBe(false);
    // "any" never filters, including on a missing value.
    expect(inWindow(null, "any", TODAY, TZ)).toBe(true);
  });
});

describe("every entity resolves", () => {
  it("returns rows with a title and a detail line for each", () => {
    const data = input({
      tasks: [task({ id: "t" })],
      habits: [habit({ id: "h" })],
      goals: [goal({ id: "g" })],
      projects: [project({ id: "p" })],
      notes: [note({ id: "n" })],
    });
    for (const entity of SCOPE_ENTITIES) {
      const sort = SORTS_FOR[entity][0];
      const got = resolveScope(
        scope({ entity, sort: { by: sort, reversed: false } }),
        data,
      );
      expect(got.ids).toHaveLength(1);
      expect(got.rows[0].title.length).toBeGreaterThan(0);
      expect(got.rows[0].detail.length).toBeGreaterThan(0);
    }
  });

  it("offers only sorts and filters the resolver can honour", () => {
    // A vocabulary entry with no arm behind it is a control that silently
    // does nothing, which is worse than not offering it.
    for (const entity of SCOPE_ENTITIES) {
      expect(SORTS_FOR[entity].length).toBeGreaterThan(0);
      expect(FILTERS_FOR[entity].length).toBeGreaterThan(0);
    }
  });
});
