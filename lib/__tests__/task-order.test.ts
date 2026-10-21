import { describe, it, expect } from "vitest";
import { sortTasksByPriority } from "@/lib/task-order";
import type { Task } from "@/lib/schemas";

function task(over: Partial<Task> & { id: string }): Task {
  return {
    userId: "u",
    title: over.id,
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

const ids = (ts: Task[]) => ts.map((t) => t.id);

describe("sortTasksByPriority", () => {
  it("puts the highest priority first", () => {
    const out = sortTasksByPriority([
      task({ id: "low", priority: "low" }),
      task({ id: "high", priority: "high" }),
      task({ id: "med", priority: "med" }),
    ]);
    expect(ids(out)).toEqual(["high", "med", "low"]);
  });

  it("ranks on priority alone — done tasks are not sunk", () => {
    const out = sortTasksByPriority([
      task({ id: "doneHigh", priority: "high", status: "done" }),
      task({ id: "openLow", priority: "low" }),
    ]);
    expect(ids(out)).toEqual(["doneHigh", "openLow"]);
  });

  it("never splits the list into two priority runs", () => {
    // Sinking done tasks used to produce high,low,high,low — which reads as a
    // broken sort. The sequence must descend exactly once.
    const out = sortTasksByPriority([
      task({ id: "doneMed", priority: "med", status: "done" }),
      task({ id: "openLow", priority: "low" }),
      task({ id: "doneHigh", priority: "high", status: "done" }),
      task({ id: "openMed", priority: "med" }),
      task({ id: "openHigh", priority: "high" }),
    ]);
    expect(ids(out)).toEqual([
      "doneHigh",
      "openHigh",
      "doneMed",
      "openMed",
      "openLow",
    ]);

    const rank = { high: 0, med: 1, low: 2 } as const;
    const ranks = out.map((t) => rank[t.priority]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("keeps timed tasks chronological within a priority band", () => {
    const out = sortTasksByPriority([
      task({ id: "afternoon", priority: "high", due: "2026-08-01T14:00" }),
      task({ id: "morning", priority: "high", due: "2026-08-01T09:00" }),
    ]);
    expect(ids(out)).toEqual(["morning", "afternoon"]);
  });

  it("puts timed tasks before untimed ones in the same band", () => {
    const out = sortTasksByPriority([
      task({ id: "untimed", priority: "high", due: "2026-08-01" }),
      task({ id: "timed", priority: "high", due: "2026-08-01T09:00" }),
    ]);
    expect(ids(out)).toEqual(["timed", "untimed"]);
  });

  it("orders a band by day before hour", () => {
    // The clock time alone used to decide, so tomorrow 09:00 beat today 14:00
    // and untimed tasks stayed in the order they were added.
    const out = sortTasksByPriority([
      task({ id: "tomorrowMorning", priority: "high", due: "2026-08-02T09:00" }),
      task({ id: "todayUntimed", priority: "high", due: "2026-08-01" }),
      task({ id: "undated", priority: "high" }),
      task({ id: "yesterday", priority: "high", due: "2026-07-31" }),
      task({ id: "todayAfternoon", priority: "high", due: "2026-08-01T14:00" }),
    ]);
    expect(ids(out)).toEqual([
      "yesterday",
      "todayAfternoon",
      "todayUntimed",
      "tomorrowMorning",
      "undated",
    ]);
  });

  it("still lets priority lead over the hour", () => {
    const out = sortTasksByPriority([
      task({ id: "medMorning", priority: "med", due: "2026-08-01T09:00" }),
      task({ id: "highAfternoon", priority: "high", due: "2026-08-01T14:00" }),
    ]);
    expect(ids(out)).toEqual(["highAfternoon", "medMorning"]);
  });

  it("is stable — equal tasks keep their original order", () => {
    const out = sortTasksByPriority([
      task({ id: "a", priority: "med" }),
      task({ id: "b", priority: "med" }),
      task({ id: "c", priority: "med" }),
    ]);
    expect(ids(out)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input", () => {
    const input = [
      task({ id: "low", priority: "low" }),
      task({ id: "high", priority: "high" }),
    ];
    sortTasksByPriority(input);
    expect(ids(input)).toEqual(["low", "high"]);
  });
});
