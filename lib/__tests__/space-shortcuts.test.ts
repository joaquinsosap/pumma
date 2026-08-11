import { describe, it, expect } from "vitest";
import { SPACE_SHORTCUTS, spaceForKey } from "@/lib/space-shortcuts";

const none = {};

describe("spaceForKey", () => {
  it("sends each digit to its space", () => {
    expect(spaceForKey("1", none)).toBe("/");
    expect(spaceForKey("2", none)).toBe("/tasks");
    expect(spaceForKey("3", none)).toBe("/notes");
    expect(spaceForKey("9", none)).toBe("/assistant");
  });

  it("keeps its hands off anything with a modifier", () => {
    // ⌘1 and ⌥1 switch browser tabs; taking them is how a web app makes
    // itself annoying to use.
    for (const mod of [
      { meta: true },
      { ctrl: true },
      { alt: true },
      { shift: true },
    ]) {
      expect(spaceForKey("1", mod)).toBeNull();
    }
  });

  it("ignores anything that is not one of the nine", () => {
    expect(spaceForKey("0", none)).toBeNull();
    expect(spaceForKey("a", none)).toBeNull();
    expect(spaceForKey("Enter", none)).toBeNull();
    expect(spaceForKey("", none)).toBeNull();
  });

  it("covers 1 to 9 exactly once, with no repeated destination", () => {
    expect(SPACE_SHORTCUTS.map((s) => s.key)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ]);
    expect(new Set(SPACE_SHORTCUTS.map((s) => s.href)).size).toBe(
      SPACE_SHORTCUTS.length,
    );
  });
});
