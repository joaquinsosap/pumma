import { describe, it, expect } from "vitest";
import { searchTasks, searchTerms, normalizeSearch } from "@/lib/task-search";
import type { Task, Tag, Project } from "@/lib/schemas";

const tags: Tag[] = [
  {
    id: "t1",
    userId: "u",
    name: "gym",
    color: "#f00",
    order: 0,
    createdAt: "",
  },
  {
    id: "t2",
    userId: "u",
    name: "work",
    color: "#00f",
    order: 1,
    createdAt: "",
  },
] as unknown as Tag[];

const projects: Project[] = [
  { id: "p1", userId: "u", title: "Kitchen remodel", color: "#0f0" },
] as unknown as Project[];

function task(over: Partial<Task> & { id: string; title: string }): Task {
  return {
    userId: "u",
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

const ctx = { tags, projects };

describe("normalizeSearch", () => {
  it("folds case and accents", () => {
    expect(normalizeSearch("Café")).toBe("cafe");
    expect(normalizeSearch("ÑOÑO")).toBe("nono");
  });
});

describe("searchTerms", () => {
  it("splits on whitespace and drops blanks", () => {
    expect(searchTerms("  buy   milk ")).toEqual(["buy", "milk"]);
  });

  it("is empty for a blank query", () => {
    expect(searchTerms("   ")).toEqual([]);
  });
});

describe("searchTasks", () => {
  const items = [
    task({ id: "1", title: "Buy milk" }),
    task({ id: "2", title: "Milk the schedule", description: "buy time" }),
    task({ id: "3", title: "Deadlift", tagIds: ["t1"] }),
    task({ id: "4", title: "Tile the floor", projectId: "p1" }),
    task({
      id: "5",
      title: "Standup",
      subtasks: [{ id: "s1", title: "Prep milk order", done: false }],
    }),
    task({ id: "6", title: "Café run" }),
  ];

  it("returns everything for a blank query", () => {
    expect(searchTasks(items, "  ", ctx)).toHaveLength(items.length);
  });

  it("matches titles case-insensitively", () => {
    expect(searchTasks(items, "DEADLIFT", ctx).map((t) => t.id)).toEqual(["3"]);
    expect(searchTasks(items, "deadlift", ctx).map((t) => t.id)).toEqual(["3"]);
  });

  it("ANDs terms regardless of order or field", () => {
    // "2" has milk in the title and buy in the description.
    expect(searchTasks(items, "milk buy", ctx).map((t) => t.id)).toEqual([
      "1",
      "2",
    ]);
  });

  it("searches descriptions, subtasks and project titles", () => {
    expect(searchTasks(items, "prep", ctx).map((t) => t.id)).toEqual(["5"]);
    expect(searchTasks(items, "kitchen", ctx).map((t) => t.id)).toEqual(["4"]);
  });

  it("matches accents both ways", () => {
    expect(searchTasks(items, "cafe", ctx).map((t) => t.id)).toEqual(["6"]);
    expect(searchTasks(items, "café", ctx).map((t) => t.id)).toEqual(["6"]);
  });

  it("scopes #tag terms to tag names", () => {
    expect(searchTasks(items, "#gym", ctx).map((t) => t.id)).toEqual(["3"]);
    // "gym" as a bare word would also match a task merely mentioning it.
    const mentions = [...items, task({ id: "7", title: "Cancel gym" })];
    expect(searchTasks(mentions, "gym", ctx).map((t) => t.id)).toEqual([
      "3",
      "7",
    ]);
    expect(searchTasks(mentions, "#gym", ctx).map((t) => t.id)).toEqual(["3"]);
  });

  it("treats a lone # as an ordinary term, not a match-all", () => {
    expect(searchTasks(items, "#", ctx)).toHaveLength(0);
  });

  it("returns nothing when a term matches nowhere", () => {
    expect(searchTasks(items, "milk zzz", ctx)).toHaveLength(0);
  });
});
