import { describe, it, expect } from "vitest";
import {
  autoTaskTitle,
  autoTitleEnd,
  noteTitleFromBody,
  parseOmni,
  tokenizeOmniInput,
} from "@/lib/parse";

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

describe("autoTaskTitle", () => {
  const long = "call the plumber about the leak in the kitchen sink";

  it("gives a long task its opening words as the title and keeps the whole text", () => {
    expect(autoTaskTitle(long, "")).toEqual({
      title: "call the plumber about the leak in the…",
      description: long,
    });
  });

  it("leaves a short task alone", () => {
    expect(autoTaskTitle("groceries for sunday", "")).toEqual({
      title: "groceries for sunday",
      description: "",
    });
    const eight = "one two three four five six seven eight";
    expect(autoTaskTitle(eight, "")).toEqual({ title: eight, description: "" });
  });

  it("lets a colon's description win", () => {
    expect(autoTaskTitle(long, "before friday")).toEqual({
      title: long,
      description: "before friday",
    });
  });

  it("clips a wall of text with no spaces at 72 characters", () => {
    const wall = "x".repeat(90);
    expect(autoTaskTitle(wall, "")).toEqual({
      title: `${"x".repeat(72)}…`,
      description: wall,
    });
  });
});

describe("autoTitleEnd", () => {
  it("lands after the eighth word, past the tag and date the parser lifted out", () => {
    const text =
      "call the #home plumber tomorrow about the leak in the kitchen sink";
    const { title } = parseOmni(text, [], new Date(2026, 9, 29));
    expect(title).toBe("call the plumber about the leak in the kitchen sink");
    expect(text.slice(0, autoTitleEnd(text, title) ?? undefined)).toBe(
      "call the #home plumber tomorrow about the leak in the",
    );
  });

  it("is null when the title is short enough to keep", () => {
    expect(autoTitleEnd("groceries for sunday", "groceries for sunday")).toBe(
      null,
    );
  });

  it("can end partway through a word the 72-character clip cut", () => {
    const wall = "x".repeat(90);
    expect(autoTitleEnd(wall, wall)).toBe(72);
  });
});

describe("tokenizeOmniInput dimFrom", () => {
  it("dims only the plain text past the cut", () => {
    const tokens = tokenizeOmniInput("one two #web three four", [], {
      dimFrom: 18,
    });
    expect(
      tokens.map((t) => [t.text, t.kind === "text" && Boolean(t.dim)]),
    ).toEqual([
      ["one two ", false],
      ["#web", false],
      [" three", false],
      [" four", true],
    ]);
  });

  it("lets a colon win over the cut", () => {
    const tokens = tokenizeOmniInput("title: one two", [], { dimFrom: 2 });
    expect(
      tokens.map((t) => [t.text, t.kind === "text" && Boolean(t.dim)]),
    ).toEqual([
      ["title", false],
      [": one two", true],
    ]);
  });
});
