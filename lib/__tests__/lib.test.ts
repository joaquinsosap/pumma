import { describe, it, expect } from "vitest";
import {
  iso,
  addDays,
  streakOf,
  bestStreak,
  weekDates,
  currentAgendaIndex,
} from "@/lib/date";
import {
  parseOmni,
  parseNoteCapture,
  splitDescription,
  toggleTagInText,
} from "@/lib/parse";
import { isReservedTagName } from "@/lib/omni-reserved";
import { defaultNoteTitle } from "@/lib/date";
import {
  buildAgendaBlocks,
  findNowPlacement,
  formatDeadTimeLabel,
  parseAgendaDurationMins,
} from "@/lib/agenda-timeline";
import { dayDonePercent, tagsByUsage } from "@/lib/metrics";
import { quarterOf, formatTopbarDateLine } from "@/lib/date-context";
import {
  DEFAULT_HABIT_VISIBILITY,
  currentHabitPeriod,
  habitBestStreak,
  habitHeatCells,
  habitStreak,
} from "@/lib/habit-visibility";
import type { Tag } from "@/lib/schemas";

const tags: Tag[] = [
  {
    id: "1",
    userId: "u",
    name: "work",
    color: "oklch(0.58 0.14 245)",
    isDefault: false,
    projectId: null,
    isProjectPrimary: false,
    order: 0,
    createdAt: "2025-01-01",
  },
];

const TZ = "UTC";

describe("date", () => {
  it("iso formats YYYY-MM-DD", () => {
    expect(iso(new Date("2025-06-15T12:00:00Z"), TZ)).toBe("2025-06-15");
  });

  it("streakOf counts consecutive days", () => {
    const td = "2026-06-21";
    const set = new Set([
      iso(addDays(-2, new Date(`${td}T12:00:00Z`), TZ), TZ),
      iso(addDays(-1, new Date(`${td}T12:00:00Z`), TZ), TZ),
      td,
    ]);
    expect(streakOf(set, td, TZ)).toBe(3);
  });

  it("bestStreak finds longest run", () => {
    const set = new Set([
      "2025-01-01",
      "2025-01-02",
      "2025-01-05",
      "2025-01-06",
    ]);
    expect(bestStreak(set)).toBe(2);
  });

  it("weekDates returns 7 days Mon-start", () => {
    const week = weekDates(new Date("2025-06-18T12:00:00Z"), "mon", TZ);
    expect(week.length).toBe(7);
    expect(iso(week[0], TZ)).toBe("2025-06-16");
    expect(iso(week[6], TZ)).toBe("2025-06-22");
  });

  it("weekDates respects Sun-start", () => {
    const week = weekDates(new Date("2025-06-18T12:00:00Z"), "sun", TZ);
    expect(iso(week[0], TZ)).toBe("2025-06-15");
    expect(iso(week[6], TZ)).toBe("2025-06-21");
  });

  it("currentAgendaIndex finds active event", () => {
    const times = ["08:00", "09:30", "11:00", "14:00"];
    expect(currentAgendaIndex(times, 7 * 60)).toBe(-1);
    expect(currentAgendaIndex(times, 8 * 60 + 15)).toBe(0);
    expect(currentAgendaIndex(times, 11 * 60 + 30)).toBe(2);
    expect(currentAgendaIndex(times, 15 * 60)).toBe(3);
  });
});

describe("parseOmni", () => {
  it("extracts tags and priority", () => {
    const r = parseOmni("review specs #work !high", tags);
    expect(r.tagIds).toContain("1");
    expect(r.priority).toBe("high");
    expect(r.title.toLowerCase()).not.toContain("#work");
  });

  it("detects tomorrow", () => {
    const ref = new Date("2026-06-21T12:00:00Z");
    const r = parseOmni("pay rent tomorrow", tags, ref, undefined, TZ);
    expect(r.due).toBe("2026-06-22");
    expect(r.dateLabel).toBeTruthy();
  });

  it("splits title from description on a colon", () => {
    const r = parseOmni("Pay rent: transfer to the landlord", tags);
    expect(r.title).toBe("Pay rent");
    expect(r.description).toBe("transfer to the landlord");
  });

  it("keeps tags and priority out of both halves", () => {
    const r = parseOmni("Pay rent #work: transfer today !high", tags);
    expect(r.title).toBe("Pay rent");
    expect(r.description).toBe("transfer");
    expect(r.tagIds).toContain("1");
    expect(r.priority).toBe("high");
  });

  it("leaves a task with no colon alone", () => {
    const r = parseOmni("buy milk", tags);
    expect(r.title).toBe("buy milk");
    expect(r.description).toBe("");
  });

  it("does not split a URL", () => {
    const r = parseOmni("read https://example.com/docs", tags);
    expect(r.title).toBe("read https://example.com/docs");
    expect(r.description).toBe("");
  });

  it("does not split a bare clock time", () => {
    // chrono lifts the time out first; either way nothing should land in the
    // description just because a colon was present.
    const r = parseOmni(
      "standup 9:30",
      tags,
      new Date("2026-06-21T12:00:00Z"),
      undefined,
      TZ,
    );
    expect(r.description).toBe("");
  });

  it("splits on the first colon only", () => {
    const r = parseOmni("Ratio: 3:1 mix", tags);
    expect(r.title).toBe("Ratio");
    expect(r.description).toBe("3:1 mix");
  });

  it("needs something on both sides", () => {
    expect(parseOmni("trailing colon:", tags).description).toBe("");
  });

  it("splits however you space the colon", () => {
    // Same thought, four typing speeds.
    for (const text of ["a:b", "a :b", "a: b", "a : b"]) {
      const r = parseOmni(text, tags);
      expect([text, r.title, r.description]).toEqual([text, "a", "b"]);
    }
  });

  it("steps over a clock time to the colon that meant it", () => {
    // Straight at the splitter: through parseOmni, chrono lifts the time out
    // of the title first and there'd be no clock left to step over.
    expect(splitDescription("standup 14:30: bring the numbers")).toEqual({
      title: "standup 14:30",
      description: "bring the numbers",
    });
    expect(splitDescription("14:30")).toEqual({
      title: "14:30",
      description: "",
    });
  });

  it("trims the title but not the description", () => {
    const r = parseOmni("  buy milk  ", tags);
    expect(r.title).toBe("buy milk");
    const d = parseOmni("buy milk: the good kind", tags);
    expect(d.title).toBe("buy milk");
    expect(d.description).toBe("the good kind");
  });

  it("toggleTagInText adds and removes tags", () => {
    expect(toggleTagInText("buy milk", "work")).toBe("buy milk #work");
    expect(toggleTagInText("buy milk #work", "work")).toBe("buy milk");
  });
});

describe("parseNoteCapture", () => {
  const ref = new Date("2026-06-21T14:35:00");

  it("splits title and body on first colon", () => {
    const r = parseNoteCapture("Meeting ideas: discuss Q3 roadmap", tags, ref);
    expect(r.title).toBe("Meeting ideas");
    expect(r.body).toBe("discuss Q3 roadmap");
  });

  it("extracts tags and applies title: body", () => {
    const r = parseNoteCapture(
      "Standup #work: action items from today",
      tags,
      ref,
    );
    expect(r.title).toBe("Standup");
    expect(r.body).toBe("action items from today");
    expect(r.tagIds).toContain("1");
  });

  it("uses timestamped title when no colon", () => {
    const r = parseNoteCapture("quick thought about the app", tags, ref, TZ);
    expect(r.title).toBe(defaultNoteTitle(ref, TZ));
    expect(r.body).toBe("quick thought about the app");
  });

  it("does not treat dates in body as due dates", () => {
    const r = parseNoteCapture("Reminder: call dentist friday", tags, ref);
    expect(r.title).toBe("Reminder");
    expect(r.body).toBe("call dentist friday");
  });
});

describe("agenda timeline", () => {
  const base = {
    color: "",
    userId: "",
    date: null,
    kind: "routine" as const,
    durationMins: 30,
    notes: "",
    recurrence: null,
    exceptions: [] as string[],
  };
  const items = [
    {
      id: "1",
      time: "08:00",
      title: "Run",
      sub: "habit",
      lifeArea: "personal" as const,
      ...base,
    },
    {
      id: "2",
      time: "09:30",
      title: "Standup",
      sub: "30 min",
      lifeArea: "work" as const,
      ...base,
    },
    {
      id: "3",
      time: "11:00",
      title: "Deep work",
      sub: "90 min block",
      lifeArea: "work" as const,
      ...base,
    },
  ];

  it("parses duration from sub", () => {
    expect(parseAgendaDurationMins("30 min")).toBe(30);
    expect(parseAgendaDurationMins("90 min block")).toBe(90);
    expect(parseAgendaDurationMins("personal")).toBeNull();
  });

  it("inserts dead time between events", () => {
    const blocks = buildAgendaBlocks(items);
    expect(blocks.some((b) => b.type === "dead")).toBe(true);
    const dead = blocks.find((b) => b.type === "dead");
    expect(dead?.type === "dead" && dead.nextTime).toBe("09:30");
  });

  it("places now line in event with progress", () => {
    const blocks = buildAgendaBlocks(items);
    const at = findNowPlacement(blocks, 9 * 60 + 45);
    expect(at.kind).toBe("event");
    if (at.kind === "event") {
      expect(at.progress).toBeCloseTo(0.5);
    }
  });

  it("places now line in dead time between events", () => {
    const blocks = buildAgendaBlocks(items);
    const at = findNowPlacement(blocks, 10 * 60 + 15);
    expect(at.kind).toBe("dead");
  });

  it("formats dead time label for active vs inactive gaps", () => {
    expect(
      formatDeadTimeLabel(8 * 60 + 30, 9 * 60 + 30, false, 0, "09:30"),
    ).toBe("08:30 to 09:30");
    expect(
      formatDeadTimeLabel(8 * 60 + 30, 9 * 60 + 30, true, 45, "09:30"),
    ).toBe("45m until 09:30");
  });
});

describe("metrics", () => {
  it("dayDonePercent blends tasks and habits", () => {
    const td = "2026-06-21";
    const pct = dayDonePercent(
      [
        {
          id: "t1",
          userId: "u",
          title: "a",
          description: "",
          subtasks: [],
          tagIds: [],
          priority: "med",
          status: "done",
          due: td,
          projectId: null,
          goalId: null,
          lifeArea: "personal",
          order: 0,
          createdAt: td,
          completedAt: td,
          timeSpentSec: 0,
          timerStartedAt: null,
        },
        {
          id: "t2",
          userId: "u",
          title: "b",
          description: "",
          subtasks: [],
          tagIds: [],
          priority: "med",
          status: "todo",
          due: td,
          projectId: null,
          goalId: null,
          lifeArea: "personal",
          order: 1,
          createdAt: td,
          completedAt: null,
          timeSpentSec: 0,
          timerStartedAt: null,
        },
      ],
      [
        {
          id: "h1",
          userId: "u",
          name: "x",
          color: "",
          frequency: { type: "daily", target: 1 },
          order: 0,
          archived: false,
          goalIds: [],
          tagIds: [],
          lifeArea: "personal",
          goalTargetStreak: null,
          createdAt: td,
        },
      ],
      [{ id: "e1", userId: "u", habitId: "h1", date: td, done: true }],
      td,
    );
    expect(pct).toBe(67);
  });
});

describe("habitHeatCells", () => {
  const visibility = DEFAULT_HABIT_VISIBILITY;
  const today = "2026-06-21";

  it("monthly habits show one cell per month", () => {
    const cells = habitHeatCells(
      "monthly",
      visibility,
      new Set(["2026-04-15", "2026-06-10"]),
      "mon",
      today,
    );
    expect(cells).toHaveLength(3);
    expect(cells[0]?.done).toBe(true);
    expect(cells[1]?.done).toBe(false);
    expect(cells[2]?.done).toBe(true);
    expect(cells[2]?.isCurrent).toBe(true);
  });

  it("weekly habits show one cell per week", () => {
    const cells = habitHeatCells("weekly", visibility, new Set(), "mon", today);
    expect(cells).toHaveLength(8);
  });

  it("daily habits show one cell per day", () => {
    const cells = habitHeatCells(
      "daily",
      visibility,
      new Set([today]),
      "mon",
      today,
    );
    expect(cells).toHaveLength(30);
    expect(cells.at(-1)?.done).toBe(true);
  });
});

describe("quarter", () => {
  it("maps months to calendar quarters", () => {
    const q = (m: number) =>
      quarterOf(new Date(Date.UTC(2026, m - 1, 15)), "UTC");
    expect([q(1), q(2), q(3)]).toEqual([1, 1, 1]);
    expect([q(4), q(5), q(6)]).toEqual([2, 2, 2]);
    expect([q(7), q(8), q(9)]).toEqual([3, 3, 3]);
    expect([q(10), q(11), q(12)]).toEqual([4, 4, 4]);
  });

  it("puts the quarter last on the topbar line", () => {
    const line = formatTopbarDateLine(new Date(Date.UTC(2026, 7, 1, 12)), {
      timeZone: "UTC",
    });
    expect(line.endsWith("· Q3")).toBe(true);
  });
});

describe("habit periods", () => {
  const vis = { dailyDays: 7, weeklyWeeks: 2, monthlyMonths: 2 };

  it("a weekly box is done when ANY day that week has an entry", () => {
    // Entries left over from when the habit was still daily.
    const entries = new Set(["2026-07-21", "2026-07-22"]); // Tue + Wed
    const cells = habitHeatCells("weekly", vis, entries, "mon", "2026-07-25");
    const current = cells[cells.length - 1];
    expect(current.done).toBe(true);
    // …and the box owns the whole week, so undoing it can clear all of them.
    expect(current.periodStart).toBe("2026-07-20");
    expect(current.periodEnd).toBe("2026-07-26");
  });

  it("exposes the period a daily box stands for (itself)", () => {
    const cells = habitHeatCells("daily", vis, new Set(), "mon", "2026-07-25");
    const last = cells[cells.length - 1];
    expect(last.periodStart).toBe("2026-07-25");
    expect(last.periodEnd).toBe("2026-07-25");
  });

  it("currentHabitPeriod matches the cadence", () => {
    expect(currentHabitPeriod("daily", "mon", "2026-07-25")).toEqual({
      start: "2026-07-25",
      end: "2026-07-25",
    });
    expect(currentHabitPeriod("weekly", "mon", "2026-07-25")).toEqual({
      start: "2026-07-20",
      end: "2026-07-26",
    });
    expect(currentHabitPeriod("monthly", "mon", "2026-07-25")).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
    });
  });
});

describe("habit streaks count the habit's own units", () => {
  it("two consecutive weeks is a streak of 2, not 1", () => {
    // One entry in each of the last two weeks (Tue, then Tue before).
    const entries = new Set(["2026-07-21", "2026-07-14"]);
    expect(habitStreak("weekly", entries, "mon", "2026-07-25")).toBe(2);
    // The old day-based count saw two non-adjacent days.
    expect(streakOf(entries, "2026-07-25")).toBe(0);
  });

  it("two months clicked is a streak of 2, not 3", () => {
    const entries = new Set(["2026-07-04", "2026-06-19"]);
    expect(habitStreak("monthly", entries, "mon", "2026-07-25")).toBe(2);
  });

  it("an unfinished current period does not break the streak", () => {
    // Nothing this week yet, but the two prior weeks are done.
    const entries = new Set(["2026-07-14", "2026-07-07"]);
    expect(habitStreak("weekly", entries, "mon", "2026-07-25")).toBe(2);
  });

  it("a missed period ends the streak", () => {
    // Week of Jul 20 done, week of Jul 13 skipped, week of Jul 6 done.
    const entries = new Set(["2026-07-21", "2026-07-07"]);
    expect(habitStreak("weekly", entries, "mon", "2026-07-25")).toBe(1);
  });

  it("daily behaves like before", () => {
    const entries = new Set(["2026-07-25", "2026-07-24", "2026-07-23"]);
    expect(habitStreak("daily", entries, "mon", "2026-07-25")).toBe(3);
  });

  it("best streak is the longest run of periods", () => {
    // Jun 1, Jul 1, Aug 1 done, then a gap, then Nov 1.
    const entries = new Set([
      "2026-06-02",
      "2026-07-02",
      "2026-08-02",
      "2026-11-02",
    ]);
    expect(habitBestStreak("monthly", entries, "mon")).toBe(3);
  });
});

describe("omnibar reserved words", () => {
  it("sets priority from #high and never tags it", () => {
    const r = parseOmni("ship it #high", tags);
    expect(r.priority).toBe("high");
    expect(r.title).toBe("ship it");
    expect(r.pills).toHaveLength(0);
    expect(r.newTagNames).toHaveLength(0);
  });

  it("maps #mid onto the med level", () => {
    expect(parseOmni("x #mid", tags).priority).toBe("med");
    expect(parseOmni("x #low", tags).priority).toBe("low");
  });

  it("reports the type and mode tokens instead of tagging them", () => {
    const t = parseOmni("ideas #note", tags);
    expect(t.typeToken).toBe("note");
    expect(t.newTagNames).toHaveLength(0);

    const a = parseOmni("what's overdue #ask", tags);
    expect(a.modeToken).toBe("ask");
    expect(a.newTagNames).toHaveLength(0);
  });

  it("resolves #today and #tomorrow without tagging them", () => {
    const ref = new Date("2026-06-21T12:00:00Z");
    const today = parseOmni("pay rent #today", tags, ref, undefined, TZ);
    expect(today.due).toBe("2026-06-21");
    expect(today.newTagNames).toHaveLength(0);

    const tom = parseOmni("pay rent #tomorrow", tags, ref, undefined, TZ);
    expect(tom.due).toBe("2026-06-22");
  });

  it("still collects ordinary tags alongside", () => {
    const r = parseOmni("ship it #high #work", tags);
    expect(r.priority).toBe("high");
    expect(r.tagIds).toContain("1");
  });

  it("refuses reserved words as tag names", () => {
    for (const name of [
      "high",
      "mid",
      "low",
      "task",
      "note",
      "plan",
      "ask",
      "today",
    ]) {
      expect(isReservedTagName(name), `${name} should be reserved`).toBe(true);
    }
    expect(isReservedTagName("work")).toBe(false);
    expect(isReservedTagName("game-dev-ops")).toBe(false);
  });
});
