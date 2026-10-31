import { describe, expect, it } from "vitest";
import type { Subtask } from "@/lib/schemas";
import {
  applySubtaskChange,
  MAX_SUBTASKS,
  type SubtaskChange,
} from "@/lib/subtask-changes";

// Frozen, so a rule that edits what it was given throws instead of passing quietly.
const water: Subtask = Object.freeze({ id: "a", title: "Water", done: true });
const weed: Subtask = Object.freeze({ id: "b", title: "Weed", done: false });
const list = Object.freeze([water, weed]) as Subtask[];

describe("adding", () => {
  it("puts a new row at the end, unticked", () => {
    expect(
      applySubtaskChange(list, { kind: "add", id: "c", title: "Plant" }),
    ).toEqual([water, weed, { id: "c", title: "Plant", done: false }]);
  });

  it("does nothing when the id is already there", () => {
    expect(
      applySubtaskChange(list, { kind: "add", id: "a", title: "Again" }),
    ).toBeNull();
  });

  it("stops at the limit", () => {
    const at = (n: number): Subtask[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        title: "x",
        done: false,
      }));
    const add: SubtaskChange = { kind: "add", id: "new", title: "x" };
    expect(applySubtaskChange(at(MAX_SUBTASKS - 1), add)).toHaveLength(
      MAX_SUBTASKS,
    );
    expect(applySubtaskChange(at(MAX_SUBTASKS), add)).toBeNull();
    expect(MAX_SUBTASKS).toBe(200);
  });
});

describe("ticking", () => {
  it("sets the row to what was asked, either way", () => {
    expect(
      applySubtaskChange(list, { kind: "setDone", id: "b", done: true }),
    ).toEqual([water, { ...weed, done: true }]);
    expect(
      applySubtaskChange(list, { kind: "setDone", id: "a", done: false }),
    ).toEqual([{ ...water, done: false }, weed]);
  });

  it("is not a flip: ticking a ticked row leaves it ticked", () => {
    expect(
      applySubtaskChange(list, { kind: "setDone", id: "a", done: true }),
    ).toEqual(list);
  });

  it("does nothing for a row that is gone", () => {
    expect(
      applySubtaskChange(list, { kind: "setDone", id: "z", done: true }),
    ).toBeNull();
  });
});

describe("renaming", () => {
  it("changes that title and keeps the id and the tick", () => {
    expect(
      applySubtaskChange(list, { kind: "rename", id: "a", title: "Irrigate" }),
    ).toEqual([{ ...water, title: "Irrigate" }, weed]);
  });

  it("does nothing for a row that is gone", () => {
    expect(
      applySubtaskChange(list, { kind: "rename", id: "z", title: "x" }),
    ).toBeNull();
  });
});

describe("removing", () => {
  it("drops that row and keeps the others in order", () => {
    expect(applySubtaskChange(list, { kind: "remove", id: "a" })).toEqual([
      weed,
    ]);
  });

  it("leaves the list as it is when the row is already gone", () => {
    expect(applySubtaskChange(list, { kind: "remove", id: "z" })).toEqual(list);
  });
});

describe("two rows sharing an id", () => {
  const twins: Subtask[] = [
    { id: "t", title: "First", done: false },
    { id: "t", title: "Second", done: false },
  ];

  it("changes only the first, as the database does", () => {
    expect(
      applySubtaskChange(twins, { kind: "setDone", id: "t", done: true }),
    ).toEqual([{ ...twins[0], done: true }, twins[1]]);
    expect(
      applySubtaskChange(twins, { kind: "rename", id: "t", title: "New" }),
    ).toEqual([{ ...twins[0], title: "New" }, twins[1]]);
  });

  it("removes both, as the database does", () => {
    expect(applySubtaskChange(twins, { kind: "remove", id: "t" })).toEqual([]);
  });
});

describe("every change", () => {
  const changes: SubtaskChange[] = [
    { kind: "add", id: "c", title: "Plant" },
    { kind: "setDone", id: "b", done: true },
    { kind: "rename", id: "a", title: "Irrigate" },
    { kind: "remove", id: "a" },
  ];

  it("leaves the list it was given alone", () => {
    const fresh = (): Subtask[] => [
      { id: "a", title: "Water", done: true },
      { id: "b", title: "Weed", done: false },
    ];
    const given = fresh();
    for (const change of changes) applySubtaskChange(given, change);
    expect(given).toEqual(fresh());
  });

  it("gives the same list when replayed, as the optimistic list does on a refresh", () => {
    for (const change of changes) {
      const once = applySubtaskChange(list, change)!;
      expect(applySubtaskChange(once, change) ?? once).toEqual(once);
    }
  });
});
