import { describe, it, expect } from "vitest";
import { dropIndex } from "@/lib/kanban-drop";

// A column of three 100px cards starting at y=0.
const card = (i: number) => ({
  overIndex: i,
  overTop: i * 100,
  overHeight: 100,
});

describe("dropIndex", () => {
  it("puts a card aimed at the top of a column first", () => {
    // The old behaviour sent this to the bottom, which is the reported bug.
    expect(dropIndex({ count: 3, ...card(0), pointerY: 5 })).toBe(0);
  });

  it("puts a card dropped past the middle of its neighbour underneath it", () => {
    expect(dropIndex({ count: 3, ...card(1), pointerY: 180 })).toBe(2);
    expect(dropIndex({ count: 3, ...card(1), pointerY: 120 })).toBe(1);
  });

  it("puts a card dropped in the empty space last", () => {
    expect(
      dropIndex({
        count: 3,
        overIndex: -1,
        pointerY: 400,
        overTop: 0,
        overHeight: 300,
      }),
    ).toBe(3);
  });

  it("lands first in an empty column however it is aimed", () => {
    expect(
      dropIndex({
        count: 0,
        overIndex: -1,
        pointerY: 40,
        overTop: 0,
        overHeight: 300,
      }),
    ).toBe(0);
  });

  it("never points past the end", () => {
    expect(dropIndex({ count: 1, ...card(0), pointerY: 999 })).toBe(1);
    expect(dropIndex({ count: 3, ...card(2), pointerY: 999 })).toBe(3);
  });
});
