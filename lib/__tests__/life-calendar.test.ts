// The life calendar is the product's namesake, and until now the only test it
// had was being looked at. These pin the parts that would lie quietly if they
// broke: the grid's alignment to the birth date, the current-week ruling that
// drives the one highlighted cell, and the lived/left arithmetic.
import { describe, expect, it } from "vitest";
import {
  buildLifeWeeks,
  clampLifeSpanYears,
  computeLifeStats,
  dayCellState,
  resolveWeekSlotStart,
  weekCellState,
} from "@/lib/life-calendar";
import { LIFE_SPAN_MAX } from "@/lib/date";

describe("buildLifeWeeks", () => {
  const weeks = buildLifeWeeks("1990-06-15", 1);

  it("aligns week one to the birth date itself, not to a Monday", () => {
    expect(weeks[0].weekStart).toBe("1990-06-15");
    expect(weeks[0].days).toHaveLength(7);
    expect(weeks[0].weekEnd).toBe("1990-06-21");
  });

  it("runs in unbroken 7-day steps", () => {
    expect(weeks[1].weekStart).toBe("1990-06-22");
    for (let i = 1; i < weeks.length - 1; i++) {
      expect(weeks[i].days).toHaveLength(7);
    }
  });

  it("trims the final week at the end of the span instead of overrunning", () => {
    const last = weeks[weeks.length - 1];
    expect(last.weekEnd < "1991-06-15").toBe(true);
    // A year is 52 weeks and change; the change is a short week, not a 53rd
    // full one.
    expect(weeks.length).toBeGreaterThanOrEqual(52);
    expect(weeks.length).toBeLessThanOrEqual(53);
  });
});

describe("weekCellState", () => {
  it("rules today's week current, on both of its edges", () => {
    expect(weekCellState("2026-08-10", "2026-08-16", "2026-08-10")).toBe(
      "current",
    );
    expect(weekCellState("2026-08-10", "2026-08-16", "2026-08-16")).toBe(
      "current",
    );
    expect(weekCellState("2026-08-10", "2026-08-16", "2026-08-13")).toBe(
      "current",
    );
  });

  it("flips past the day after the week ends, future the day before it starts", () => {
    expect(weekCellState("2026-08-10", "2026-08-16", "2026-08-17")).toBe(
      "past",
    );
    expect(weekCellState("2026-08-10", "2026-08-16", "2026-08-09")).toBe(
      "future",
    );
  });
});

describe("dayCellState", () => {
  it("is exact about today", () => {
    expect(dayCellState("2026-08-15", "2026-08-15")).toBe("today");
    expect(dayCellState("2026-08-14", "2026-08-15")).toBe("past");
    expect(dayCellState("2026-08-16", "2026-08-15")).toBe("future");
  });
});

describe("resolveWeekSlotStart", () => {
  it("maps any day of a week to that week's canonical start", () => {
    const weeks = buildLifeWeeks("1990-06-15", 1);
    expect(resolveWeekSlotStart("1990-06-18", weeks)).toBe("1990-06-15");
    expect(resolveWeekSlotStart("1990-06-22", weeks)).toBe("1990-06-22");
  });

  it("hands back a date it cannot place rather than inventing one", () => {
    expect(resolveWeekSlotStart("2050-01-01", [])).toBe("2050-01-01");
  });
});

describe("computeLifeStats", () => {
  const stats = computeLifeStats("1990-06-15", 80, "2026-08-15");

  it("splits the span into lived and left without losing a day", () => {
    expect(stats.livedDays + stats.leftDays).toBe(stats.totalDays);
    expect(stats.livedWeeks + stats.leftWeeks).toBe(stats.totalWeeks);
  });

  it("agrees with the calendar about age", () => {
    expect(stats.ageYears).toBe(36);
  });

  it("keeps percentages inside 0 to 100", () => {
    expect(stats.livedPct).toBeGreaterThan(0);
    expect(stats.livedPct).toBeLessThan(100);
  });
});

describe("clampLifeSpanYears", () => {
  it("holds the span to sane bounds and whole years", () => {
    expect(clampLifeSpanYears(0)).toBe(1);
    expect(clampLifeSpanYears(80.9)).toBe(80);
    expect(clampLifeSpanYears(10_000)).toBe(LIFE_SPAN_MAX);
  });
});
