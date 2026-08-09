import { describe, it, expect } from "vitest";
import {
  habitAppliesOn,
  habitBestStreak,
  habitHeatCells,
  habitScheduleLabel,
  habitStreak,
} from "@/lib/habit-visibility";

const weekdays = { type: "daily", target: 1, days: [1, 2, 3, 4, 5] };
const everyDay = { type: "daily", target: 1 };

// 2026-08-10 is a Monday, so 15th/16th are Sat/Sun.
describe("habitAppliesOn", () => {
  it("applies on the weekdays it names", () => {
    expect(habitAppliesOn(weekdays, "2026-08-10")).toBe(true); // Mon
    expect(habitAppliesOn(weekdays, "2026-08-14")).toBe(true); // Fri
  });

  it("does not apply at the weekend", () => {
    expect(habitAppliesOn(weekdays, "2026-08-15")).toBe(false); // Sat
    expect(habitAppliesOn(weekdays, "2026-08-16")).toBe(false); // Sun
  });

  it("treats no days, empty days and all seven as every day", () => {
    for (const f of [
      everyDay,
      { type: "daily", target: 1, days: [] },
      { type: "daily", target: 1, days: [0, 1, 2, 3, 4, 5, 6] },
    ]) {
      expect(habitAppliesOn(f, "2026-08-15")).toBe(true);
    }
  });

  it("ignores weekdays on habits that aren't daily — a week has no weekday", () => {
    expect(
      habitAppliesOn({ type: "weekly", target: 1, days: [1] }, "2026-08-15"),
    ).toBe(true);
  });
});

describe("habitScheduleLabel", () => {
  it("names a contiguous run as a range", () => {
    expect(habitScheduleLabel(weekdays)).toBe("Mon–Fri");
  });

  it("lists a scattered set", () => {
    expect(
      habitScheduleLabel({ type: "daily", target: 1, days: [1, 3, 5] }),
    ).toBe("Mon, Wed, Fri");
  });

  it("says every day when it means every day", () => {
    expect(habitScheduleLabel(everyDay)).toBe("Every day");
  });
});

describe("habitStreak with a weekday schedule", () => {
  // Kept Mon-Fri of the week of the 10th, nothing at the weekend.
  const kept = new Set([
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
  ]);

  it("survives the weekend it was never meant to cover", () => {
    // Asked on the Sunday: the two days off must not end the run.
    expect(habitStreak("daily", kept, "mon", "2026-08-16", weekdays)).toBe(5);
  });

  it("breaks on a weekend when the habit does run every day", () => {
    expect(habitStreak("daily", kept, "mon", "2026-08-16", everyDay)).toBe(0);
  });

  it("matches the old behaviour when no schedule is passed at all", () => {
    expect(habitStreak("daily", kept, "mon", "2026-08-16")).toBe(
      habitStreak("daily", kept, "mon", "2026-08-16", everyDay),
    );
  });

  it("counts the run when asked on a working day", () => {
    expect(habitStreak("daily", kept, "mon", "2026-08-14", weekdays)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// A schedule is a lens over the record, never an edit to it.
//
// Narrowing a habit to weekdays must not touch what was logged: the Saturdays
// stay in the database and simply stop being looked at. These check the
// "stop being looked at" half — that a day off contributes nothing in either
// direction, whatever it holds.

describe("days off are ignored, not deleted", () => {
  it("a Saturday tick does not extend a weekday streak", () => {
    // Fri 14th done, Sat 15th also ticked, Sun 16th nothing. Asked on Sunday.
    const entries = new Set(["2026-08-14", "2026-08-15"]);
    expect(habitStreak("daily", entries, "mon", "2026-08-16", weekdays)).toBe(
      1,
    );
    // The same record, read as an every-day habit, counts both.
    expect(habitStreak("daily", entries, "mon", "2026-08-16", everyDay)).toBe(
      2,
    );
  });

  it("a missed Saturday does not break a weekday streak", () => {
    const entries = new Set(["2026-08-13", "2026-08-14", "2026-08-17"]);
    // Thu, Fri, then Mon: three in a row for a weekday habit.
    expect(habitStreak("daily", entries, "mon", "2026-08-17", weekdays)).toBe(
      3,
    );
    // Read as every day, the weekend is two holes and the run is just Monday.
    expect(habitStreak("daily", entries, "mon", "2026-08-17", everyDay)).toBe(
      1,
    );
  });

  it("counts a best run across a weekend for a weekday habit", () => {
    const entries = new Set([
      "2026-08-13", // Thu
      "2026-08-14", // Fri
      "2026-08-17", // Mon
      "2026-08-18", // Tue
    ]);
    expect(habitBestStreak("daily", entries, "mon", weekdays)).toBe(4);
    expect(habitBestStreak("daily", entries, "mon", everyDay)).toBe(2);
  });

  it("leaves a lone weekend tick out of the best run entirely", () => {
    const entries = new Set(["2026-08-15", "2026-08-16"]); // Sat + Sun only
    expect(habitBestStreak("daily", entries, "mon", weekdays)).toBe(0);
    expect(habitBestStreak("daily", entries, "mon", everyDay)).toBe(2);
  });

  it("hides a day off in the strip without dropping its box", () => {
    const entries = new Set(["2026-08-14", "2026-08-15"]);
    const cells = habitHeatCells(
      "daily",
      { dailyDays: 7, weeklyWeeks: 12, monthlyMonths: 12 },
      entries,
      "mon",
      "2026-08-16",
      "UTC",
      weekdays,
    );
    // Seven boxes for seven days, whatever the schedule says.
    expect(cells).toHaveLength(7);
    const sat = cells.find((c) => c.id === "2026-08-15")!;
    const fri = cells.find((c) => c.id === "2026-08-14")!;
    expect(sat.applies).toBe(false);
    // Recorded, but not shown as done — the entry is still in `entries`.
    expect(sat.done).toBe(false);
    expect(entries.has("2026-08-15")).toBe(true);
    expect(fri.applies).toBe(true);
    expect(fri.done).toBe(true);
  });
});
