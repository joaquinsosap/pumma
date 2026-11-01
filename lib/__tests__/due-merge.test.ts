import { describe, expect, it } from "vitest";
import { mergeTaskDueDate, mergeTaskDueTime } from "@/lib/date";

describe("mergeTaskDueTime", () => {
  it("puts the time on the stored date", () => {
    expect(mergeTaskDueTime("2026-11-05", "09:30")).toBe("2026-11-05T09:30");
  });

  it("replaces a stored time", () => {
    expect(mergeTaskDueTime("2026-11-05T09:30", "18:00")).toBe("2026-11-05T18:00");
  });

  it("clears only the time", () => {
    expect(mergeTaskDueTime("2026-11-05T09:30", null)).toBe("2026-11-05");
  });

  it("has nothing to put a time on without a date", () => {
    expect(mergeTaskDueTime(null, "09:30")).toBeNull();
  });
});

describe("mergeTaskDueDate", () => {
  it("keeps the stored time", () => {
    expect(mergeTaskDueDate("2026-12-01", "2026-11-05T09:30")).toBe("2026-12-01T09:30");
  });

  it("is just the date when no time is stored", () => {
    expect(mergeTaskDueDate("2026-12-01", "2026-11-05")).toBe("2026-12-01");
    expect(mergeTaskDueDate("2026-12-01", null)).toBe("2026-12-01");
  });
});
