import { describe, it, expect } from "vitest";
import type { AgendaItem, Recurrence } from "@/lib/schemas";
import {
  describeRecurrence,
  expandMeetings,
  meetingTimeRange,
  meetingsOnDay,
  occurrenceDates,
  weekdayOf,
} from "@/lib/meetings";

function meeting(over: Partial<AgendaItem> = {}): AgendaItem {
  return {
    id: "m1",
    userId: "u",
    time: "10:00",
    title: "Standup",
    sub: "meeting",
    color: "#000",
    lifeArea: "work",
    date: "2026-07-06", // a Monday
    kind: "meeting",
    durationMins: 30,
    notes: "",
    recurrence: null,
    exceptions: [],
    ...over,
  };
}

const rec = (over: Partial<Recurrence>): Recurrence => ({
  freq: "weekly",
  interval: 1,
  byWeekday: [],
  until: null,
  count: null,
  ...over,
});

describe("occurrenceDates", () => {
  it("returns a one-off meeting only inside the range", () => {
    const m = meeting();
    expect(occurrenceDates(m, "2026-07-01", "2026-07-31")).toEqual([
      "2026-07-06",
    ]);
    expect(occurrenceDates(m, "2026-07-07", "2026-07-31")).toEqual([]);
  });

  it("ignores legacy dateless routine rows", () => {
    expect(
      occurrenceDates(
        { date: null, recurrence: null, exceptions: [] },
        "2026-07-01",
        "2026-07-31",
      ),
    ).toEqual([]);
  });

  it("expands a daily rule", () => {
    const m = meeting({ recurrence: rec({ freq: "daily" }) });
    expect(occurrenceDates(m, "2026-07-06", "2026-07-09")).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
    ]);
  });

  it("honours an interval on a daily rule", () => {
    const m = meeting({ recurrence: rec({ freq: "daily", interval: 3 }) });
    expect(occurrenceDates(m, "2026-07-06", "2026-07-16")).toEqual([
      "2026-07-06",
      "2026-07-09",
      "2026-07-12",
      "2026-07-15",
    ]);
  });

  it("defaults a weekly rule to the start weekday", () => {
    const m = meeting({ recurrence: rec({ freq: "weekly" }) });
    expect(occurrenceDates(m, "2026-07-06", "2026-07-27")).toEqual([
      "2026-07-06",
      "2026-07-13",
      "2026-07-20",
      "2026-07-27",
    ]);
  });

  it("expands weekly byWeekday (Mon + Wed)", () => {
    const m = meeting({
      recurrence: rec({ freq: "weekly", byWeekday: [1, 3] }),
    });
    expect(occurrenceDates(m, "2026-07-06", "2026-07-16")).toEqual([
      "2026-07-06", // Mon
      "2026-07-08", // Wed
      "2026-07-13",
      "2026-07-15",
    ]);
  });

  it("never emits before the series start even when byWeekday precedes it", () => {
    // Series starts Wed; rule also includes Mon, which is earlier that week.
    const m = meeting({
      date: "2026-07-08", // Wednesday
      recurrence: rec({ freq: "weekly", byWeekday: [1, 3] }),
    });
    expect(occurrenceDates(m, "2026-07-01", "2026-07-14")).toEqual([
      "2026-07-08",
      "2026-07-13",
    ]);
  });

  it("counts whole weeks for a fortnightly rule", () => {
    const m = meeting({ recurrence: rec({ freq: "weekly", interval: 2 }) });
    expect(occurrenceDates(m, "2026-07-06", "2026-08-04")).toEqual([
      "2026-07-06",
      "2026-07-20",
      "2026-08-03",
    ]);
  });

  it("expands a monthly rule on the same day-of-month", () => {
    const m = meeting({
      date: "2026-01-12",
      recurrence: rec({ freq: "monthly" }),
    });
    expect(occurrenceDates(m, "2026-01-01", "2026-04-30")).toEqual([
      "2026-01-12",
      "2026-02-12",
      "2026-03-12",
      "2026-04-12",
    ]);
  });

  it("skips short months for a monthly rule on the 31st", () => {
    const m = meeting({
      date: "2026-01-31",
      recurrence: rec({ freq: "monthly" }),
    });
    // February and April have no 31st — skipped, not clamped.
    expect(occurrenceDates(m, "2026-01-01", "2026-05-31")).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
    ]);
  });

  it("stops at an inclusive until date", () => {
    const m = meeting({
      recurrence: rec({ freq: "daily", until: "2026-07-08" }),
    });
    expect(occurrenceDates(m, "2026-07-01", "2026-07-31")).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
    ]);
  });

  it("stops after count occurrences", () => {
    const m = meeting({ recurrence: rec({ freq: "daily", count: 3 }) });
    expect(occurrenceDates(m, "2026-07-01", "2026-07-31")).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
    ]);
  });

  it("removes excepted dates without shifting the series", () => {
    const m = meeting({
      recurrence: rec({ freq: "daily" }),
      exceptions: ["2026-07-07"],
    });
    expect(occurrenceDates(m, "2026-07-06", "2026-07-09")).toEqual([
      "2026-07-06",
      "2026-07-08",
      "2026-07-09",
    ]);
  });

  it("lets an excepted date still consume a count slot (RFC 5545)", () => {
    const m = meeting({
      recurrence: rec({ freq: "daily", count: 3 }),
      exceptions: ["2026-07-07"],
    });
    // 3 generated (06, 07, 08); 07 removed — the series does NOT extend to 09.
    expect(occurrenceDates(m, "2026-07-01", "2026-07-31")).toEqual([
      "2026-07-06",
      "2026-07-08",
    ]);
  });

  it("windows a long-running series to just the requested range", () => {
    const m = meeting({ recurrence: rec({ freq: "daily" }) });
    expect(occurrenceDates(m, "2027-01-01", "2027-01-03")).toEqual([
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });
});

describe("expandMeetings", () => {
  it("sorts by date then start time and skips non-meetings", () => {
    const late = meeting({ id: "a", time: "15:00", title: "Late" });
    const early = meeting({ id: "b", time: "09:00", title: "Early" });
    const routine = meeting({ id: "c", kind: "routine", date: null });
    const out = expandMeetings(
      [late, early, routine],
      "2026-07-01",
      "2026-07-31",
    );
    expect(out.map((o) => o.item.title)).toEqual(["Early", "Late"]);
  });

  it("flags recurring instances", () => {
    const m = meeting({ recurrence: rec({ freq: "weekly" }) });
    const out = expandMeetings([m], "2026-07-06", "2026-07-13");
    expect(out).toHaveLength(2);
    expect(out.every((o) => o.recurring)).toBe(true);
  });

  it("meetingsOnDay narrows to a single day", () => {
    const m = meeting({ recurrence: rec({ freq: "daily" }) });
    expect(meetingsOnDay([m], "2026-07-09").map((o) => o.date)).toEqual([
      "2026-07-09",
    ]);
  });
});

describe("helpers", () => {
  it("weekdayOf is DST-proof", () => {
    expect(weekdayOf("2026-07-06")).toBe(1); // Monday
    expect(weekdayOf("2026-07-05")).toBe(0); // Sunday
  });

  it("describes rules readably", () => {
    expect(describeRecurrence(null)).toBe("Does not repeat");
    expect(describeRecurrence(rec({ freq: "daily" }))).toBe("Every day");
    expect(describeRecurrence(rec({ freq: "daily", interval: 2 }))).toBe(
      "Every 2 days",
    );
    expect(describeRecurrence(rec({ freq: "weekly", byWeekday: [1, 3] }))).toBe(
      "Weekly on Mon, Wed",
    );
    expect(
      describeRecurrence(rec({ freq: "weekly", interval: 2, byWeekday: [2] })),
    ).toBe("Every 2 weeks on Tue");
    expect(describeRecurrence(rec({ freq: "monthly" }), "2026-01-12")).toBe(
      "Monthly on day 12",
    );
    expect(describeRecurrence(rec({ freq: "daily", count: 5 }))).toBe(
      "Every day · 5×",
    );
    expect(
      describeRecurrence(rec({ freq: "daily", until: "2026-09-01" })),
    ).toBe("Every day · until 2026-09-01");
  });

  it("formats a time range across the hour", () => {
    expect(meetingTimeRange("10:00", 30)).toBe("10:00 to 10:30");
    expect(meetingTimeRange("10:45", 90)).toBe("10:45 to 12:15");
  });
});
