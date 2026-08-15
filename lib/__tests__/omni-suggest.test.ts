import { describe, it, expect } from "vitest";
import {
  activeToken,
  applyCompletion,
  suggestCompletions,
  tagSuggestions,
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

  it("keeps whatever followed the caret, without doubling the space", () => {
    // This used to assert "call #health  about it" — two spaces — which was a
    // wart the test had frozen in place rather than a behaviour anyone wanted.
    const res = applyCompletion("call #he about it", 8, {
      word: "health",
      kind: "tag",
    });
    expect(res.text).toBe("call #health about it");
  });

  it("appends the tag when there is no token, spacing it properly", () => {
    // Tapping a tag chip while looking at "my task" plainly means "tag this",
    // so it appends rather than doing nothing.
    const res = applyCompletion("my task", 7, { word: "tag", kind: "tag" });
    expect(res.text).toBe("my task #tag ");
    expect(res.caret).toBe(res.text.length);
  });

  it("does not double the space when one is already there", () => {
    expect(
      applyCompletion("my task ", 8, { word: "tag", kind: "tag" }).text,
    ).toBe("my task #tag ");
  });

  it("adds no leading space at the very start", () => {
    expect(applyCompletion("", 0, { word: "tag", kind: "tag" }).text).toBe(
      "#tag ",
    );
  });

  it("appends at the caret, keeping what follows", () => {
    const res = applyCompletion("pay rent today", 8, {
      word: "finance",
      kind: "tag",
    });
    expect(res.text).toBe("pay rent #finance today");
  });
});

describe("tagSuggestions", () => {
  it("offers the tags themselves, for the bar's resting state", () => {
    expect(tagSuggestions(tags).map((s) => s.word)).toEqual([
      "health",
      "home-office",
      "work",
    ]);
    expect(tagSuggestions(tags)[0].kind).toBe("tag");
    expect(tagSuggestions(tags)[0].color).toBe("#0f0");
  });

  it("stays within the row it has to fit in", () => {
    expect(tagSuggestions(tags, 2)).toHaveLength(2);
  });
});
