// list_projects and list_goals follow the app's life toggle: "both" is
// everything, and a personal or work filter also keeps items tagged "both".
import { describe, expect, it, vi } from "vitest";
import type { Goal, Project } from "@/lib/schemas";
import type { McpCaller } from "@/lib/mcp/context";

const base: Project = {
  id: "p0",
  userId: "u1",
  title: "Project",
  description: "",
  color: "oklch(0.6 0.13 250)",
  progress: 0,
  label: "",
  goalId: null,
  tagIds: [],
  lifeArea: "personal",
  createdAt: "2026-10-20",
};

const projects: Project[] = [
  { ...base, id: "home", lifeArea: "personal" },
  { ...base, id: "job", lifeArea: "work" },
  { ...base, id: "side", lifeArea: "both" },
];

const goalBase: Goal = {
  id: "g0",
  userId: "u1",
  title: "Goal",
  category: "personal",
  metricLabel: "",
  progress: 0,
  targetDate: null,
  tagIds: [],
  lifeArea: "personal",
  order: 0,
  createdAt: "2026-10-20",
};

const goals: Goal[] = [
  { ...goalBase, id: "health", category: "personal", lifeArea: "personal" },
  { ...goalBase, id: "promo", category: "work", lifeArea: "work" },
  // A goal tagged both stores category "personal".
  { ...goalBase, id: "money", category: "personal", lifeArea: "both" },
];

vi.mock("@/lib/db/goals", () => ({ listGoals: async () => goals }));
vi.mock("@/lib/db/projects", () => ({ listProjects: async () => projects }));
vi.mock("@/lib/db/tasks", () => ({ listTasks: async () => [], getTask: async () => null }));

const { listProjectsTool, listGoalsTool } = await import("@/lib/mcp/tools/collections");
const caller = { userId: "u1" } as McpCaller;

async function ids(lifeArea?: "personal" | "work" | "both") {
  const out = await listProjectsTool.handler({ lifeArea, limit: 100 }, caller);
  return (out.data as { projects: { id: string }[] }).projects.map((p) => p.id);
}

describe("list_projects lifeArea filter", () => {
  it("returns every project for both", async () => {
    expect(await ids("both")).toEqual(["home", "job", "side"]);
  });

  it("returns every project with no filter", async () => {
    expect(await ids()).toEqual(["home", "job", "side"]);
  });

  it("keeps projects tagged both under a single area", async () => {
    expect(await ids("personal")).toEqual(["home", "side"]);
    expect(await ids("work")).toEqual(["job", "side"]);
  });
});

describe("list_goals category filter", () => {
  async function goalIds(category?: "personal" | "work") {
    const out = await listGoalsTool.handler({ category, limit: 100 }, caller);
    return (out.text.match(/^ {2}(\S+)/gm) ?? []).map((l) => l.trim());
  }

  it("shows a goal tagged both under work, as the app's Work view does", async () => {
    expect(await goalIds("work")).toEqual(["promo", "money"]);
  });

  it("returns every goal with no filter", async () => {
    expect(await goalIds()).toEqual(["health", "promo", "money"]);
  });
});
