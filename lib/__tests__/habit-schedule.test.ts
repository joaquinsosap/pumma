import { describe, it, expect } from "vitest";
import {
  habitAppliesOn,
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
