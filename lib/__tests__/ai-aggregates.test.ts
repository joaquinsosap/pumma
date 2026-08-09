import { describe, it, expect } from "vitest";
import { buildAggregates } from "@/lib/ai/aggregates";

const TODAY = "2026-08-02";
const TZ = "UTC";

const base = {
  tasks: [],
  habits: [],
  entries: [],
  projects: [],
  goals: [],
  tags: [],
  today: TODAY,
  timezone: TZ,
};

const task = (
  over: Partial<Parameters<typeof buildAggregates>[0]["tasks"][0]> = {},
) => ({
  status: "todo" as const,
  priority: "med" as const,
  due: null,
  lifeArea: "personal",
  projectId: null,
  tagIds: [],
  createdAt: "2026-07-01",
  completedAt: null,
  timeSpentSec: 0,
  ...over,
});

describe("task counts", () => {
  it("splits by status and only counts open tasks in the slices", () => {
    const agg = buildAggregates({
      ...base,
      tasks: [
        task(),
        task({ status: "doing", priority: "high" }),
        task({ status: "done", completedAt: "2026-08-01", priority: "high" }),
      ],
    });
    expect(agg.tasks.byStatus).toEqual({ todo: 1, doing: 1, done: 1 });
    // The finished high-priority task must not show up as open work.
    expect(agg.tasks.openByPriority).toEqual({ low: 0, med: 1, high: 1 });
    expect(agg.tasks.open).toBe(2);
  });

  it("counts overdue and due-today against the given day", () => {
    const agg = buildAggregates({
      ...base,
      tasks: [
        task({ due: "2026-07-30" }),
        task({ due: TODAY }),
        // Finished late is not overdue — it's finished.
        task({ due: "2026-07-01", status: "done", completedAt: "2026-07-02" }),
      ],
    });
    expect(agg.tasks.overdue).toBe(1);
    expect(agg.tasks.dueToday).toBe(1);
  });

  it("files open tasks under project titles and counts the rest as unfiled", () => {
    const agg = buildAggregates({
      ...base,
      projects: [{ id: "p1", title: "Kitchen", progress: 0 }],
      tasks: [task({ projectId: "p1" }), task({ projectId: "p1" }), task()],
    });
    expect(agg.tasks.openByProject).toEqual({ Kitchen: 2 });
    expect(agg.tasks.unfiled).toBe(1);
  });
});

describe("completions by week", () => {
  it("puts this week's completion in the final bucket", () => {
    const agg = buildAggregates({
      ...base,
      tasks: [
        task({ status: "done", completedAt: TODAY }),
        task({ status: "done", completedAt: "2026-07-20" }),
      ],
    });
    expect(agg.completionsByWeek).toHaveLength(12);
    expect(agg.completionsByWeek.at(-1)?.completed).toBe(1);
    // 2026-07-20 is 13 days back → the second-to-last bucket.
    expect(agg.completionsByWeek.at(-2)?.completed).toBe(1);
  });
});

describe("time tracked", () => {
  it("sums hours per project, one decimal", () => {
    const agg = buildAggregates({
      ...base,
      projects: [{ id: "p1", title: "Kitchen", progress: 0 }],
      tasks: [
        task({ projectId: "p1", timeSpentSec: 5400 }), // 1.5h
        task({ timeSpentSec: 1800 }), // 0.5h, unfiled
      ],
    });
    expect(agg.time.totalHours).toBe(2);
    expect(agg.time.byProjectHours).toEqual({ Kitchen: 1.5, unfiled: 0.5 });
  });
});

describe("projects: idleness", () => {
  it("reports days since the last completion, null when nothing ever finished", () => {
    const agg = buildAggregates({
      ...base,
      projects: [
        { id: "p1", title: "Moving", progress: 10 },
        { id: "p2", title: "Untouched", progress: 0 },
      ],
      tasks: [
        task({ projectId: "p1", status: "done", completedAt: "2026-07-19" }),
        task({ projectId: "p1" }),
        task({ projectId: "p2" }),
      ],
    });
    const moving = agg.projects.find((p) => p.title === "Moving");
    const untouched = agg.projects.find((p) => p.title === "Untouched");
    expect(moving?.idleDays).toBe(14);
    expect(moving?.openTasks).toBe(1);
    expect(untouched?.idleDays).toBeNull();
  });
});

describe("habits", () => {
  it("skips archived habits and counts the last 30 days", () => {
    const agg = buildAggregates({
      ...base,
      habits: [
        { id: "h1", name: "Run", archived: false },
        { id: "h2", name: "Old", archived: true },
      ],
      entries: [
        { habitId: "h1", date: TODAY },
        { habitId: "h1", date: "2026-08-01" },
        { habitId: "h1", date: "2026-06-01" }, // outside the window
        { habitId: "h2", date: TODAY },
      ],
    });
    expect(agg.habits).toHaveLength(1);
    expect(agg.habits[0].name).toBe("Run");
    expect(agg.habits[0].streak).toBe(2);
    expect(agg.habits[0].last30).toBe(2);
  });
});
