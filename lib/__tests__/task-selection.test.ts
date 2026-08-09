import { describe, it, expect } from "vitest";
import {
  EMPTY_SELECTION,
  intentFor,
  pruneSelection,
  reduceSelection,
  type SelectionState,
} from "@/lib/task-selection";

const ORDER = ["a", "b", "c", "d", "e"];
const LONG = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"];

const state = (
  ids: string[],
  anchor: string | null = null,
): SelectionState => ({
  ids,
  anchor,
});

describe("intentFor", () => {
  it("reads a plain click as not-a-selection", () => {
    expect(intentFor({})).toBe("open");
  });

  it("treats cmd and ctrl the same", () => {
    expect(intentFor({ metaKey: true })).toBe("toggle");
    expect(intentFor({ ctrlKey: true })).toBe("toggle");
  });

  it("separates range from range-add", () => {
    expect(intentFor({ shiftKey: true })).toBe("range");
    expect(intentFor({ shiftKey: true, metaKey: true })).toBe("rangeAdd");
  });
});

describe("toggle", () => {
  it("adds, and keeps the list's own order", () => {
    const next = reduceSelection(state(["c"]), ORDER, "a", "toggle");
    expect(next.ids).toEqual(["a", "c"]);
    expect(next.anchor).toBe("a");
  });

  it("removes one that's already selected", () => {
    const next = reduceSelection(state(["a", "c"]), ORDER, "c", "toggle");
    expect(next.ids).toEqual(["a"]);
  });
});

describe("range", () => {
  it("covers everything between the anchor and the click, inclusive", () => {
    const next = reduceSelection(state(["b"], "b"), ORDER, "d", "range");
    expect(next.ids).toEqual(["b", "c", "d"]);
  });

  it("works upwards too", () => {
    const next = reduceSelection(state(["d"], "d"), ORDER, "b", "range");
    expect(next.ids).toEqual(["b", "c", "d"]);
  });

  it("grows across the anchor instead of dropping the half you had", () => {
    // The reported bug: anchored on 6, shift-click 1 (→ 1…6), then shift-click
    // 11. Measuring from the anchor would give 6…11 and silently lose 1…5.
    const back = reduceSelection(state(["6"], "6"), LONG, "1", "range");
    expect(back.ids).toEqual(["1", "2", "3", "4", "5", "6"]);
    const forward = reduceSelection(back, LONG, "11", "range");
    expect(forward.ids).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
    ]);
  });

  it("still shrinks when the click stays on the same side of the anchor", () => {
    const grown = reduceSelection(state(["6"], "6"), LONG, "11", "range");
    expect(grown.ids).toEqual(["6", "7", "8", "9", "10", "11"]);
    const shrunk = reduceSelection(grown, LONG, "8", "range");
    expect(shrunk.ids).toEqual(["6", "7", "8"]);
  });

  it("shrinks from the far end once the range has crossed the anchor", () => {
    // 1…11 with the anchor still at 6: clicking 3 pulls the bottom edge up
    // and keeps the top, rather than collapsing back to 3…6.
    const wide = state(LONG, "6");
    expect(reduceSelection(wide, LONG, "3", "range").ids).toEqual([
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
    ]);
  });

  it("keeps the anchor, so repeated shift-clicks resize one range", () => {
    const first = reduceSelection(state(["b"], "b"), ORDER, "e", "range");
    expect(first.ids).toEqual(["b", "c", "d", "e"]);
    const shrunk = reduceSelection(first, ORDER, "c", "range");
    expect(shrunk.ids).toEqual(["b", "c"]);
    expect(shrunk.anchor).toBe("b");
  });

  it("replaces the selection, while range-add keeps what was there", () => {
    // "a" sits outside the new span, so it's the one that tells the two
    // apart: a plain range drops it, range-add keeps it.
    const base = state(["a", "d"], "d");
    expect(reduceSelection(base, ORDER, "b", "range").ids).toEqual([
      "b",
      "c",
      "d",
    ]);
    expect(reduceSelection(base, ORDER, "b", "rangeAdd").ids).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("with no anchor yet, selects just the click and becomes the anchor", () => {
    const next = reduceSelection(EMPTY_SELECTION, ORDER, "c", "range");
    expect(next).toEqual({ ids: ["c"], anchor: "c" });
  });

  it("re-anchors when the old anchor has been filtered out of the list", () => {
    // "z" was selected before the filter changed; it isn't on screen now.
    const next = reduceSelection(state(["z"], "z"), ORDER, "b", "range");
    expect(next).toEqual({ ids: ["b"], anchor: "b" });
  });
});

describe("a plain click", () => {
  it("clears the selection — the caller opens the task instead", () => {
    expect(
      reduceSelection(state(["a", "b"], "a"), ORDER, "c", "open").ids,
    ).toEqual([]);
  });

  it("still leaves an anchor, so the next shift-click ranges from it", () => {
    // Otherwise the first shift-click after opening a task selects only
    // itself, and you have to shift-click twice to get a range.
    const clicked = reduceSelection(EMPTY_SELECTION, ORDER, "b", "open");
    expect(clicked.anchor).toBe("b");
    expect(reduceSelection(clicked, ORDER, "d", "range").ids).toEqual([
      "b",
      "c",
      "d",
    ]);
  });
});

describe("pruneSelection", () => {
  it("returns the same object when nothing was lost", () => {
    const s = state(["a", "b"], "a");
    expect(pruneSelection(s, ORDER)).toBe(s);
  });

  it("drops ids and an anchor that left the list", () => {
    const next = pruneSelection(state(["a", "gone"], "gone"), ORDER);
    expect(next).toEqual({ ids: ["a"], anchor: null });
  });
});
