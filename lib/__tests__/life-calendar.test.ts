// The life calendar is the product's namesake, and until now the only test it
// had was being looked at. These pin the parts that would lie quietly if they
// broke: the grid's alignment to the birth date, the current-week ruling that
// drives the one highlighted cell, and the lived/left arithmetic.
import { describe, expect, it } from "vitest";
import {
  birthdayAgeInWeek,
  buildLifeWeeks,
  clampLifeSpanYears,
  computeLifeStats,
  dayCellState,
  resolveWeekSlotStart,
  weekCellState,
  weekHoldsBirthday,
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

describe("birthday weeks", () => {
  const birth = "1990-06-15";
  const weeks = buildLifeWeeks(birth, 30);
  const starred = weeks.filter((w) => weekHoldsBirthday(w, birth));

  it("stars one week for the day of birth and one for every year lived", () => {
    // The span ends the day before the 30th birthday, so ages 0 to 29.
    expect(starred).toHaveLength(30);
    expect(starred.map((w) => birthdayAgeInWeek(w, birth))).toEqual(
      Array.from({ length: 30 }, (_, age) => age),
    );
  });

  it("stars the first week of the grid, the one the birth date starts", () => {
    expect(weekHoldsBirthday(weeks[0], birth)).toBe(true);
    expect(birthdayAgeInWeek(weeks[0], birth)).toBe(0);
  });

  it("follows the date, not the column, as a row of 52 weeks falls behind the year", () => {
    const columns = starred.map((w) => (w.weekIndex - 1) % 52);
    expect(columns[0]).toBe(0);
    // A row is 364 days and a year is not, so the star walks right.
    expect(new Set(columns).size).toBeGreaterThan(1);
    for (const w of starred) {
      expect(w.days.some((d) => d.endsWith("-06-15"))).toBe(true);
    }
  });

  it("puts a Feb 29 birthday on Mar 1 in a year without one", () => {
    const leapBirth = "1992-02-29";
    const leapWeeks = buildLifeWeeks(leapBirth, 9);
    const days = leapWeeks
      .filter((w) => weekHoldsBirthday(w, leapBirth))
      .map((w) =>
        w.days.find((d) => d.endsWith("-02-29") || d.endsWith("-03-01")),
      );
    expect(days).toEqual([
      "1992-02-29",
      "1993-03-01",
      "1994-03-01",
      "1995-03-01",
      "1996-02-29",
      "1997-03-01",
      "1998-03-01",
      "1999-03-01",
      "2000-02-29",
    ]);
  });

  it("stars nothing without a birth date", () => {
    expect(weekHoldsBirthday(weeks[0], null)).toBe(false);
    expect(birthdayAgeInWeek(weeks[0], "")).toBeNull();
  });
});
