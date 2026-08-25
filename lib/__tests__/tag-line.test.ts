// The tag line under a task title must never wrap: one double-height row in a
// seventy-row list reads as a bug. These pin the arithmetic that decides what
// fits, including the cases where the counter itself is what pushes a tag out.
import { describe, expect, it } from "vitest";
import { budgetForWidth, fitTagLine } from "@/lib/tag-line";

const tags = (...names: string[]) =>
  names.map((name, i) => ({ id: `t${i}`, name, color: "#000" }));

describe("fitTagLine", () => {
  it("shows nothing for a task with no tags", () => {
    expect(fitTagLine([], 40)).toEqual({ shown: [], hidden: 0 });
  });

  it("shows everything when it all fits", () => {
    // "#work #idea" is 11 characters against a budget of 40.
    const t = tags("work", "idea");
    const fit = fitTagLine(t, 40);
    expect(fit.shown).toHaveLength(2);
    expect(fit.hidden).toBe(0);
  });

  it("drops the tags that do not fit and counts them", () => {
    const t = tags("work", "idea", "health", "finance", "reading");
    const fit = fitTagLine(t, 20);
    expect(fit.shown.length).toBeLessThan(5);
    expect(fit.hidden).toBe(5 - fit.shown.length);
  });

  it("keeps shown plus hidden equal to the total, always", () => {
    const t = tags("a", "bb", "ccc", "dddd", "eeeee", "ffffff");
    for (const budget of [8, 12, 16, 20, 30, 46, 100]) {
      const fit = fitTagLine(t, budget);
      expect(fit.shown.length + fit.hidden).toBe(6);
    }
  });

  it("never exceeds the budget it was given", () => {
    const t = tags("work", "idea", "health", "finance", "reading", "personal");
    for (const budget of [10, 14, 20, 24, 30, 46]) {
      const fit = fitTagLine(t, budget);
      // "#name" joined by two spaces, plus the counter when something is left.
      const width =
        fit.shown.reduce((n, tg, i) => n + (i ? 2 : 0) + tg.name.length + 1, 0) +
        (fit.hidden > 0 ? 2 + 1 + String(fit.hidden).length : 0);
      // The one exception is a single tag longer than the whole budget.
      if (fit.shown.length > 1) expect(width).toBeLessThanOrEqual(budget);
    }
  });

  it("leaves room for the counter rather than overrunning it", () => {
    // Three tags where the first two exactly fill the line: the third cannot
    // be shown, so "+1" has to fit, and that may cost the second tag its place.
    const t = tags("engineering", "operations", "x");
    const fit = fitTagLine(t, 16);
    expect(fit.hidden).toBeGreaterThan(0);
    const width = fit.shown.reduce(
      (n, tg, i) => n + (i ? 2 : 0) + tg.name.length + 1,
      0,
    );
    expect(width + 2 + 1 + String(fit.hidden).length).toBeLessThanOrEqual(16);
  });

  it("does not reserve counter space when the last tag fits", () => {
    // "#work" + gap + "#idea" is 5 + 2 + 5 = 12 wide (the gap is two character
    // widths, matching the 8px it renders as). A budget of exactly 12 has to
    // fit both: no room should be set aside for a counter that will not be
    // rendered. At 11 the second tag genuinely does not fit.
    expect(fitTagLine(tags("work", "idea"), 12)).toMatchObject({ hidden: 0 });
    expect(fitTagLine(tags("work", "idea"), 12).shown).toHaveLength(2);
    expect(fitTagLine(tags("work", "idea"), 11).hidden).toBe(1);
  });

  it("still renders one tag too long for the line, rather than only a count", () => {
    // A bare "+1" with no tag at all looks like the tag was deleted. CSS trims
    // the overflow; the reader still sees which tag it is.
    const fit = fitTagLine(tags("a-very-long-tag-name-indeed", "work"), 10);
    expect(fit.shown).toHaveLength(1);
    expect(fit.shown[0].name).toBe("a-very-long-tag-name-indeed");
    expect(fit.hidden).toBe(1);
  });

  it("preserves the given order instead of packing short tags first", () => {
    // Reordering by length would reshuffle every row whenever a tag is
    // renamed, which is worse than showing fewer.
    const fit = fitTagLine(tags("engineering", "ab", "cd"), 46);
    expect(fit.shown.map((t) => t.name)).toEqual(["engineering", "ab", "cd"]);
  });

  it("fits the real-world case at real measured widths", () => {
    const t = tags("idea", "work", "health");
    // A full-width desktop row.
    expect(fitTagLine(t, budgetForWidth(600)).hidden).toBe(0);
    // The same list with the detail panel open, where the fixed grid tracks
    // leave the title cell about 73px. This is the case fixed tiers missed:
    // every tier assumed at least 132px and silently clipped here.
    const cramped = fitTagLine(t, budgetForWidth(73));
    expect(cramped.shown.length).toBeGreaterThanOrEqual(1);
    expect(cramped.shown.length + cramped.hidden).toBe(3);
  });
});

describe("budgetForWidth", () => {
  it("is zero for a container with no width, not negative", () => {
    // Before the first measurement the element can report 0.
    expect(budgetForWidth(0)).toBe(0);
  });

  it("keeps a character of slack so the line never touches the edge", () => {
    // 66px is exactly ten 6.6px characters; nine is what should be offered.
    expect(budgetForWidth(66)).toBe(9);
  });

  it("grows with the container", () => {
    expect(budgetForWidth(300)).toBeGreaterThan(budgetForWidth(150));
  });
});
