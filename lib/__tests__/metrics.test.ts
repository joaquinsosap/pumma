// The numbers at the top of every page: day-done percent, project progress,
// tag counts, the streak in the corner. Wrong here is wrong everywhere at
// once, and silently — a plausible-looking 60% needs a test to be caught.
import { describe, expect, it } from "vitest";
import {
  dayDonePercent,
  habitsDoneToday,
  projectProgress,
  tagCount,
  topStreak,
} from "@/lib/metrics";
import type { Habit, HabitEntry, Task } from "@/lib/schemas";

const task = (over: Partial<Task>): Task =>
  ({
    id: Math.random().toString(16),
    status: "todo",
    tagIds: [],
    due: null,
    ...over,
  }) as Task;
const habit = (id: string): Habit => ({ id, name: id }) as Habit;
const entry = (habitId: string, date: string): HabitEntry =>
  ({ id: `${habitId}:${date}`, habitId, date }) as HabitEntry;

const TODAY = "2026-08-15";

describe("dayDonePercent", () => {
  it("is 0 with nothing due and no habits — not NaN, not 100", () => {
    expect(dayDonePercent([], [], [], TODAY)).toBe(0);
  });

  it("pools today's tasks and habits into one percentage", () => {
    const tasks = [
      task({ due: TODAY, status: "done" }),
      task({ due: TODAY, status: "todo" }),
      // Not due today: must not count either way.
      task({ due: "2026-08-20", status: "done" }),
    ];
    const habits = [habit("h1"), habit("h2")];
    const entries = [entry("h1", TODAY), entry("h2", "2026-08-14")];
    // 1 of 2 tasks + 1 of 2 habits = 2 of 4.
    expect(dayDonePercent(tasks, habits, entries, TODAY)).toBe(50);
  });

  it("counts a task due today regardless of a time suffix", () => {
    const tasks = [task({ due: `${TODAY}T14:00`, status: "done" })];
    expect(dayDonePercent(tasks, [], [], TODAY)).toBe(100);
  });
});

describe("projectProgress", () => {
  it("reads 0/0 for an empty project instead of dividing by zero", () => {
    expect(projectProgress("p", [])).toEqual({ progress: 0, label: "0/0" });
  });

  it("reports done over linked, and rounds", () => {
    const tasks = [
      task({ projectId: "p", status: "done" }),
      task({ projectId: "p", status: "todo" }),
      task({ projectId: "p", status: "doing" }),
    ];
    expect(projectProgress("p", tasks)).toEqual({ progress: 33, label: "1/3" });
  });
});

describe("tagCount", () => {
  it("adds tasks and notes that carry the tag", () => {
    const tasks = [task({ tagIds: ["t"] }), task({ tagIds: [] })];
    const notes = [{ tagIds: ["t"] }, { tagIds: ["t"] }];
    expect(tagCount("t", tasks, notes)).toBe(3);
  });
});

describe("habitsDoneToday", () => {
  it("only counts an entry dated today", () => {
    const habits = [habit("h1"), habit("h2")];
    const entries = [entry("h1", TODAY), entry("h2", "2026-08-14")];
    expect(habitsDoneToday(habits, entries, TODAY)).toEqual({
      done: 1,
      total: 2,
      label: "1 / 2",
    });
  });
});

describe("topStreak", () => {
  it("is 0 with no habits — the Math.max(-Infinity) trap", () => {
    expect(topStreak([], [], () => 99)).toBe(0);
  });

  it("takes the best habit, each judged over only its own entries", () => {
    const habits = [habit("h1"), habit("h2")];
    const entries = [
      entry("h1", "2026-08-14"),
      entry("h1", "2026-08-15"),
      entry("h2", "2026-08-15"),
    ];
    const bySize = (dates: Set<string>) => dates.size;
    expect(topStreak(habits, entries, bySize)).toBe(2);
  });
});
