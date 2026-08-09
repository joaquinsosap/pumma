import { describe, it, expect } from "vitest";
import {
  applyTaskFilters,
  countActiveFilters,
  hasActiveFilters,
  toggleFilterValue,
  NO_FILTERS,
  TASK_STATUSES,
  TASK_PRIORITIES,
} from "@/lib/task-filters";
import type { Task } from "@/lib/schemas";

function task(over: Partial<Task> & { id: string }): Task {
  return {
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
    createdAt: "",
    completedAt: null,
    timeSpentSec: 0,
    timerStartedAt: null,
    ...over,
  } as Task;
}

const items = [
  task({ id: "a", status: "todo", priority: "high", tagIds: ["work"] }),
  task({
    id: "b",
    status: "doing",
    priority: "med",
    tagIds: ["work", "health"],
  }),
  task({ id: "c", status: "done", priority: "low", tagIds: ["health"] }),
  task({ id: "d", status: "done", priority: "high" }),
];

const ids = (ts: Task[]) => ts.map((t) => t.id);

describe("applyTaskFilters", () => {
  it("returns everything when no facet is set", () => {
    expect(ids(applyTaskFilters(items, NO_FILTERS))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("filters by status", () => {
    expect(
      ids(applyTaskFilters(items, { ...NO_FILTERS, status: ["done"] })),
    ).toEqual(["c", "d"]);
  });

  it("ORs within a facet — 'not done' is todo + doing", () => {
    expect(
      ids(
        applyTaskFilters(items, { ...NO_FILTERS, status: ["todo", "doing"] }),
      ),
    ).toEqual(["a", "b"]);
  });

  it("ANDs across facets", () => {
    expect(
      ids(
        applyTaskFilters(items, {
          ...NO_FILTERS,
          status: ["done"],
          priority: ["high"],
        }),
      ),
    ).toEqual(["d"]);
  });

  it("matches tasks having ANY of the selected tags", () => {
    expect(
      ids(applyTaskFilters(items, { ...NO_FILTERS, tagIds: ["health"] })),
    ).toEqual(["b", "c"]);
    expect(
      ids(
        applyTaskFilters(items, { ...NO_FILTERS, tagIds: ["work", "health"] }),
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("treats every value selected the same as none selected", () => {
    expect(
      ids(applyTaskFilters(items, { ...NO_FILTERS, status: TASK_STATUSES })),
    ).toEqual(ids(items));
  });

  it("can produce an empty result", () => {
    expect(
      applyTaskFilters(items, {
        ...NO_FILTERS,
        status: ["todo"],
        priority: ["low"],
      }),
    ).toEqual([]);
  });
});

describe("countActiveFilters", () => {
  it("sums selected values across facets", () => {
    expect(countActiveFilters(NO_FILTERS)).toBe(0);
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(
      countActiveFilters({
        status: ["todo", "doing"],
        priority: ["high"],
        tagIds: [],
      }),
    ).toBe(3);
  });
});

describe("toggleFilterValue", () => {
  it("adds and removes", () => {
    expect(toggleFilterValue<string>([], "todo")).toEqual(["todo"]);
    expect(toggleFilterValue(["todo"], "todo")).toEqual([]);
  });

  it("keeps the canonical facet order rather than click order", () => {
    let v: string[] = [];
    v = toggleFilterValue(v, "done", TASK_STATUSES);
    v = toggleFilterValue(v, "todo", TASK_STATUSES);
    expect(v).toEqual(["todo", "done"]);

    let p: string[] = [];
    p = toggleFilterValue(p, "low", TASK_PRIORITIES);
    p = toggleFilterValue(p, "high", TASK_PRIORITIES);
    expect(p).toEqual(["high", "low"]);
  });
});
