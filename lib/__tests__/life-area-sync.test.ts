import { describe, it, expect } from "vitest";
import {
  deriveLifeAreaFromTags,
  withLifeTags,
  isLifeTag,
  withProjectLifeTags,
  setLifeTags,
  goalCategoryForLifeArea,
} from "@/lib/life-area-sync";
import { filterByLifeView, filterGoalsByLifeView } from "@/lib/life-area";

const tags = [
  { id: "t-work", name: "work" },
  { id: "t-personal", name: "personal" },
  { id: "t-other", name: "idea" },
];

describe("deriveLifeAreaFromTags", () => {
  it("both special tags -> both", () => {
    expect(deriveLifeAreaFromTags(["t-work", "t-personal"], tags)).toBe("both");
  });

  it("work tag only -> work", () => {
    expect(deriveLifeAreaFromTags(["t-work"], tags)).toBe("work");
  });

  it("personal tag only -> personal", () => {
    expect(deriveLifeAreaFromTags(["t-personal"], tags)).toBe("personal");
  });

  it("falls back to personal when no life tag is present", () => {
    // Shouldn't happen — every create path attaches one — but showing up in
    // the wrong view beats vanishing from all of them.
    expect(deriveLifeAreaFromTags(["t-other"], tags)).toBe("personal");
    expect(deriveLifeAreaFromTags([], tags)).toBe("personal");
  });

  it("matches tag names case-insensitively", () => {
    const upperTags = [
      { id: "t-work", name: "Work" },
      { id: "t-personal", name: "PERSONAL" },
    ];
    expect(deriveLifeAreaFromTags(["t-work"], upperTags)).toBe("work");
    expect(deriveLifeAreaFromTags(["t-work", "t-personal"], upperTags)).toBe(
      "both"
    );
  });
});

describe("withLifeTags", () => {
  it("attaches the view's tag when none is set", () => {
    expect(withLifeTags([], "work", tags)).toEqual(["t-work"]);
    expect(withLifeTags([], "personal", tags)).toEqual(["t-personal"]);
  });

  it("attaches both in the Both view", () => {
    expect(withLifeTags([], "both", tags)).toEqual(["t-personal", "t-work"]);
  });

  it("leaves an explicit life tag alone", () => {
    // "#work" typed while sitting in Personal means work.
    expect(withLifeTags(["t-work"], "personal", tags)).toEqual(["t-work"]);
    expect(withLifeTags(["t-personal"], "work", tags)).toEqual(["t-personal"]);
  });

  it("keeps ordinary tags and never duplicates", () => {
    expect(withLifeTags(["t-other"], "work", tags)).toEqual([
      "t-other",
      "t-work",
    ]);
    expect(withLifeTags(["t-other", "t-work"], "work", tags)).toEqual([
      "t-other",
      "t-work",
    ]);
  });

  it("guarantees a life tag for every view", () => {
    for (const view of ["personal", "work", "both"] as const) {
      const out = withLifeTags(["t-other"], view, tags);
      expect(
        out.includes("t-work") || out.includes("t-personal"),
        `view ${view} produced no life tag`
      ).toBe(true);
    }
  });
});

describe("isLifeTag", () => {
  it("recognises the two protected names, whatever the casing", () => {
    expect(isLifeTag("work")).toBe(true);
    expect(isLifeTag(" Personal ")).toBe(true);
    expect(isLifeTag("idea")).toBe(false);
  });
});

describe("filterByLifeView", () => {
  const items = [
    { id: "1", lifeArea: "personal" as const },
    { id: "2", lifeArea: "work" as const },
    { id: "3", lifeArea: "both" as const },
  ];

  it("both view returns everything", () => {
    expect(filterByLifeView(items, "both").map((i) => i.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("personal view includes personal + both items", () => {
    expect(filterByLifeView(items, "personal").map((i) => i.id)).toEqual([
      "1",
      "3",
    ]);
  });

  it("work view includes work + both items", () => {
    expect(filterByLifeView(items, "work").map((i) => i.id)).toEqual([
      "2",
      "3",
    ]);
  });
});

describe("filterGoalsByLifeView", () => {
  // Goals filter on lifeArea like everything else; the column only mirrors it.
  const goals = [
    { id: "p", lifeArea: "personal" as const },
    { id: "w", lifeArea: "work" as const },
    { id: "b", lifeArea: "both" as const },
  ];

  it("shows everything in the both view", () => {
    expect(filterGoalsByLifeView(goals, "both").map((g) => g.id)).toEqual([
      "p",
      "w",
      "b",
    ]);
  });

  it("narrows to the matching category", () => {
    expect(filterGoalsByLifeView(goals, "personal").map((g) => g.id)).toEqual([
      "p",
      "b",
    ]);
    expect(filterGoalsByLifeView(goals, "work").map((g) => g.id)).toEqual([
      "w",
      "b",
    ]);
  });
});

describe("withProjectLifeTags", () => {
  it("switches the life tag rather than adding one", () => {
    // A personal task dragged into a work project is work, not both.
    expect(withProjectLifeTags(["t-personal", "t-other"], "work", tags)).toEqual(
      ["t-other", "t-work"]
    );
  });

  it("collapses both down to the project's side", () => {
    expect(
      withProjectLifeTags(["t-personal", "t-work"], "personal", tags)
    ).toEqual(["t-personal"]);
  });

  it("leaves tags alone when there's no project", () => {
    expect(withProjectLifeTags(["t-personal"], null, tags)).toEqual([
      "t-personal",
    ]);
  });

  it("keeps ordinary tags", () => {
    expect(withProjectLifeTags(["t-other"], "work", tags)).toEqual([
      "t-other",
      "t-work",
    ]);
  });
});

describe("setLifeTags", () => {
  const tags = [
    { id: "p", name: "personal" },
    { id: "w", name: "work" },
    { id: "h", name: "health" },
  ];

  it("replaces rather than adds — a move is not a widening", () => {
    expect(setLifeTags(["p", "h"], "work", tags)).toEqual(["h", "w"]);
  });

  it("attaches both sides for the both view", () => {
    expect(setLifeTags(["h"], "both", tags)).toEqual(["h", "p", "w"]);
  });

  it("leaves tags alone when the account has no life tags", () => {
    expect(setLifeTags(["h"], "work", [{ id: "h", name: "health" }])).toEqual([
      "h",
    ]);
  });
});

describe("goal columns mirror the life tags", () => {
  it("puts a work goal in the work column", () => {
    expect(goalCategoryForLifeArea("work")).toBe("work");
    expect(goalCategoryForLifeArea("personal")).toBe("personal");
  });

  it("keeps a both-tagged goal on the personal side", () => {
    expect(goalCategoryForLifeArea("both")).toBe("personal");
  });
});
