import { describe, it, expect } from "vitest";
import { noteTitleFromBody } from "@/lib/parse";

describe("noteTitleFromBody", () => {
  it("takes the first eight words", () => {
    expect(
      noteTitleFromBody("call the plumber about the leak in the kitchen sink"),
    ).toBe("call the plumber about the leak in the…");
  });

  it("takes all of a short note, with nothing to signal", () => {
    expect(noteTitleFromBody("groceries for sunday")).toBe(
      "groceries for sunday",
    );
    // Exactly eight is not truncated, so it gets no ellipsis.
    expect(noteTitleFromBody("one two three four five six seven eight")).toBe(
      "one two three four five six seven eight",
    );
  });

  it("stops at the end of the first line", () => {
    expect(noteTitleFromBody("Shopping list\nmilk\neggs\nbread")).toBe(
      "Shopping list",
    );
  });

  it("drops punctuation left dangling by the cut", () => {
    expect(
      noteTitleFromBody("ask about the roof, the gutters, and the drains"),
    ).toBe("ask about the roof, the gutters, and the…");
  });

  it("clips a line with no spaces in it", () => {
    const title = noteTitleFromBody("x".repeat(200));
    expect(title).toBe("x".repeat(72) + "…");
  });

  it("has nothing to offer for an empty note", () => {
    expect(noteTitleFromBody("")).toBe("");
    expect(noteTitleFromBody("   \n  ")).toBe("");
  });
});
