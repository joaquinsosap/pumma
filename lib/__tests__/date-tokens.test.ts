import { describe, it, expect } from "vitest";
import {
  DATE_COMPLETIONS,
  DATE_WORDS,
  isDateToken,
  resolveDateToken,
} from "@/lib/date-tokens";
import { candidatesFor } from "@/lib/omni-complete";

// A Tuesday, so "this week" and "next week" are both reachable in the tests.
const TUE = new Date(2026, 7, 4); // 2026-08-04

describe("relative days", () => {
  it("reads the three words everyone types", () => {
    expect(resolveDateToken("today", TUE)?.date).toBe("2026-08-04");
    expect(resolveDateToken("tomorrow", TUE)?.date).toBe("2026-08-05");
    expect(resolveDateToken("yesterday", TUE)?.date).toBe("2026-08-03");
  });

  it("labels them the way the chip reads", () => {
    expect(resolveDateToken("tomorrow", TUE)?.label).toBe("Tomorrow");
  });
});

describe("weekdays", () => {
  it("looks forward within the week", () => {
    expect(resolveDateToken("friday", TUE)?.date).toBe("2026-08-07");
  });

  it("rolls into next week once the day has passed", () => {
    // Monday is yesterday from a Tuesday, so it means the coming one.
    expect(resolveDateToken("monday", TUE)?.date).toBe("2026-08-10");
  });

  it("naming today's own day means a week's time, not today", () => {
    // "#today" is how you say today; "#tuesday" on a Tuesday is the next one.
    expect(resolveDateToken("tuesday", TUE)?.date).toBe("2026-08-11");
  });

  it("takes the short forms too", () => {
    expect(resolveDateToken("fri", TUE)?.date).toBe(
      resolveDateToken("friday", TUE)?.date,
    );
    expect(resolveDateToken("weds", TUE)?.date).toBe(
      resolveDateToken("wednesday", TUE)?.date,
    );
  });

  it("labels with the full name whichever form was typed", () => {
    expect(resolveDateToken("fri", TUE)?.label).toBe("Friday");
  });
});

describe("numeric dates", () => {
  it("reads day-first by default", () => {
    expect(resolveDateToken("7/8", TUE)?.date).toBe("2026-08-07");
  });

  it("reads month-first when that's the setting", () => {
    // 9/8 is ahead of the reference either way round, so this is about the
    // order alone and not about the roll-forward rule below.
    expect(resolveDateToken("9/8", TUE)?.date).toBe("2026-08-09");
    expect(resolveDateToken("9/8", TUE, "mdy")?.date).toBe("2026-09-08");
  });

  it("takes any of the separators people actually use", () => {
    for (const s of ["/", "-", "."]) {
      expect(resolveDateToken(`7${s}8`, TUE)?.date).toBe("2026-08-07");
    }
  });

  it("takes a two- or four-digit year", () => {
    expect(resolveDateToken("7/8/27", TUE)?.date).toBe("2027-08-07");
    expect(resolveDateToken("7/8/2027", TUE)?.date).toBe("2027-08-07");
  });

  it("rolls a past day-month into next year rather than the past", () => {
    // 1 January, typed in August, can only mean the January that's coming.
    expect(resolveDateToken("1/1", TUE)?.date).toBe("2027-01-01");
  });

  it("reads an impossible order the way it must have been meant", () => {
    // 25 can't be a month, so "25/12" is Christmas even under mdy.
    expect(resolveDateToken("25/12", TUE, "mdy")?.date).toBe("2026-12-25");
  });

  it("refuses a day that doesn't exist rather than rolling it over", () => {
    expect(resolveDateToken("31/2", TUE)).toBeNull();
    expect(resolveDateToken("32/1", TUE)).toBeNull();
  });
});

describe("what isn't a date", () => {
  it("leaves ordinary tag names alone", () => {
    for (const w of [
      "work",
      "finance",
      "prime",
      "website-redesign",
      "mon-project",
    ]) {
      expect(resolveDateToken(w, TUE)).toBeNull();
    }
  });

  it("is what keeps those names out of the tag namespace", () => {
    expect(isDateToken("friday")).toBe(true);
    expect(isDateToken("4/8")).toBe(true);
    expect(isDateToken("finance")).toBe(false);
  });
});

describe("the completion vocabulary", () => {
  it("offers every word it can actually resolve", () => {
    for (const w of DATE_WORDS) {
      expect(resolveDateToken(w, TUE), w).not.toBeNull();
    }
  });

  it("puts the long names first, so the list reads as English", () => {
    expect(DATE_WORDS.indexOf("monday")).toBeLessThan(
      DATE_WORDS.indexOf("mon"),
    );
  });
});

describe("the completion list can actually settle", () => {
  it("offers one candidate per abbreviation, so Tab lands", () => {
    // The bug this exists for: a pool holding "fri" AND "friday" makes "fri"
    // match two things, so Tab rotated between two spellings of the same day
    // for ever and looked broken.
    for (const short of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
      expect(candidatesFor(short, DATE_COMPLETIONS), short).toHaveLength(1);
    }
    expect(candidatesFor("tomo", DATE_COMPLETIONS)).toEqual(["tomorrow"]);
    expect(candidatesFor("y", DATE_COMPLETIONS)).toEqual(["yesterday"]);
  });

  it("still resolves the short forms it no longer offers", () => {
    for (const w of DATE_WORDS) {
      expect(resolveDateToken(w, TUE), w).not.toBeNull();
    }
  });

  it("keeps a genuinely ambiguous prefix ambiguous", () => {
    // "t" really could be four different days — rotating there is correct.
    expect(candidatesFor("t", DATE_COMPLETIONS).length).toBeGreaterThan(1);
  });
});
