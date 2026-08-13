import { describe, it, expect } from "vitest";
import {
  activeToken,
  applyCompletion,
  suggestCompletions,
} from "@/lib/omni-suggest";

const tags = [
  { name: "health", color: "#0f0" },
  { name: "home-office", color: "#00f" },
  { name: "work", color: "#f00" },
];

const words = (text: string, caret = text.length) =>
  suggestCompletions(text, caret, tags).map((s) => s.word);

describe("activeToken", () => {
  it("finds the hash the caret is still inside", () => {
    expect(activeToken("pay rent #fin", 13)).toEqual({
      start: 9,
      end: 13,
      fragment: "fin",
    });
  });

  it("treats a bare # as the start of one", () => {
    expect(activeToken("pay rent #", 10)?.fragment).toBe("");
  });

  it("lets a space close it", () => {
    expect(activeToken("pay rent #work now", 18)).toBeNull();
  });

  it("has nothing to say about plain prose", () => {
    expect(activeToken("pay rent tomorrow", 17)).toBeNull();
  });

  it("follows the caret, not the end of the line", () => {
    // Caret inside "#he", with more text after it.
    expect(activeToken("call #he about it", 8)?.fragment).toBe("he");
  });
});

describe("suggestCompletions", () => {
  it("narrows as you type", () => {
    expect(words("#h")).toContain("health");
    // "hea" trails as a new-tag offer: a name that is a prefix of an existing
    // tag still has to be creatable.
    expect(words("#hea")).toEqual(["health", "hea"]);
  });

  it("offers your own tags before the bar's own words", () => {
    const all = words("#h");
    expect(all.indexOf("health")).toBeLessThan(all.indexOf("high"));
  });

  it("puts an exact name first even when longer ones extend it", () => {
    const extended = [...tags, { name: "workshop", color: "#ff0" }];
    const got = suggestCompletions("#work", 5, extended).map((s) => s.word);
    expect(got[0]).toBe("work");
  });

  it("offers to invent a tag, but never one that exists", () => {
    expect(suggestCompletions("#groceries", 10, tags).at(-1)).toEqual({
      word: "groceries",
      kind: "new",
    });
    expect(words("#health")).not.toContain("health!");
    expect(
      suggestCompletions("#health", 7, tags).filter((s) => s.kind === "new"),
    ).toEqual([]);
  });

  it("says nothing when the caret is not in a token", () => {
    expect(words("just a task")).toEqual([]);
    expect(words("#work done")).toEqual([]);
  });

  it("stays within the row it has to fit in", () => {
    expect(suggestCompletions("#", 1, tags, 4)).toHaveLength(4);
  });
});

describe("applyCompletion", () => {
  it("replaces the fragment and leaves the caret past a space", () => {
    const res = applyCompletion("pay rent #fin", 13, {
      word: "finance",
      kind: "new",
    });
    expect(res.text).toBe("pay rent #finance ");
    expect(res.caret).toBe(18);
  });

  it("keeps whatever followed the caret", () => {
    const res = applyCompletion("call #he about it", 8, {
      word: "health",
      kind: "tag",
    });
    expect(res.text).toBe("call #health  about it");
  });

  it("does nothing when there is no token to finish", () => {
    const res = applyCompletion("nothing here", 12, {
      word: "health",
      kind: "tag",
    });
    expect(res.text).toBe("nothing here");
  });
});
