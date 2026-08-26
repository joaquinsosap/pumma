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

// The gaps between cards belong to the column, not to either neighbour, so a
// release there names no card and arrives here as overIndex -1. That used to
// mean "last", which is why a quick drag sometimes threw a card to the bottom
// of the list instead of leaving it where it was let go.
//
// Three cards, 100px tall, 8px apart, first one starting at y=0:
//   card 0   0..100    mid  50
//   gap     100..108
//   card 1  108..208   mid 158
//   gap     208..216
//   card 2  216..316   mid 266
describe("released on bare column, between cards", () => {
  const slots = [50, 158, 266];
  const onColumn = (pointerY: number) =>
    dropIndex({
      count: 3,
      overIndex: -1,
      pointerY,
      overTop: 0,
      overHeight: 400,
      slots,
    });

  it("puts it in the gap it was dropped in, not at the end", () => {
    expect(onColumn(104)).toBe(1); // gap between card 0 and card 1
    expect(onColumn(212)).toBe(2); // gap between card 1 and card 2
  });

  it("still appends below the last card", () => {
    expect(onColumn(320)).toBe(3);
    expect(onColumn(999)).toBe(3);
  });

  it("puts it first above the first card", () => {
    expect(onColumn(2)).toBe(0);
  });

  it("treats an empty column as last, which is also first", () => {
    expect(
      dropIndex({
        count: 0,
        overIndex: -1,
        pointerY: 120,
        overTop: 0,
        overHeight: 400,
        slots: [],
      }),
    ).toBe(0);
  });

  it("falls back to appending when nothing was measured", () => {
    // Order of `slots` is irrelevant: the answer is a count, so a stale or
    // shuffled list still lands in the right slot.
    expect(
      dropIndex({
        count: 3,
        overIndex: -1,
        pointerY: 212,
        overTop: 0,
        overHeight: 400,
        slots: [266, 50, 158],
      }),
    ).toBe(2);
    expect(
      dropIndex({ count: 3, overIndex: -1, pointerY: 212, overTop: 0, overHeight: 400 }),
    ).toBe(3);
  });
});
