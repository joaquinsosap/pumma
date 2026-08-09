import { describe, it, expect } from "vitest";
import { carryoverSpanLabel } from "@/lib/carryover";

const today = "2026-08-09";

describe("carryoverSpanLabel", () => {
  it("says yesterday when that is as far back as it goes", () => {
    expect(carryoverSpanLabel(["2026-08-08"], today)).toBe("yesterday");
  });

  it("gives the oldest one's age while the pile is younger than a week", () => {
    expect(carryoverSpanLabel(["2026-08-06"], today)).toBe("3 days ago");
    expect(carryoverSpanLabel(["2026-08-04"], today)).toBe("5 days ago");
  });

  it("calls a week or more last week", () => {
    expect(carryoverSpanLabel(["2026-08-02"], today)).toBe("last week");
    expect(carryoverSpanLabel(["2026-07-28"], today)).toBe("last week");
  });

  it("measures from the oldest, not the newest", () => {
    // One from yesterday and one from five days ago is a five-day pile.
    expect(carryoverSpanLabel(["2026-08-08", "2026-08-04"], today)).toBe(
      "5 days ago",
    );
  });

  it("ignores today and anything still ahead", () => {
    expect(carryoverSpanLabel([today, "2026-08-20"], today)).toBeNull();
    // …but still reads the overdue one sitting beside them.
    expect(carryoverSpanLabel([today, "2026-08-08"], today)).toBe("yesterday");
  });

  it("takes a full timestamp as readily as a date", () => {
    expect(carryoverSpanLabel(["2026-08-08T14:30:00.000Z"], today)).toBe(
      "yesterday",
    );
  });

  it("has nothing to say about an empty pile", () => {
    expect(carryoverSpanLabel([], today)).toBeNull();
  });
});
