// The nudge fires at most once per setting, and only when the user's own
// trail earns it. Wrong here is a nag, and a nag in a capture flow teaches
// people not to capture: these tests are the product promise.
import { describe, expect, it } from "vitest";
import {
  markAnswered,
  nudgeVerdict,
  recordChoice,
  WINDOW,
  type NudgeAnswered,
  type NudgeHistory,
} from "@/lib/nudge";

const NONE: NudgeAnswered = {};

/** Record a sequence of choices from empty. */
const trail = (...values: string[]): NudgeHistory =>
  values.reduce<NudgeHistory>(
    (h, v) => recordChoice(h, NONE, "captureType", v),
    {},
  );

describe("recordChoice", () => {
  it("keeps at most the window, dropping the oldest", () => {
    const h = trail("a", "b", "c", "d", "e");
    expect(h.captureType).toEqual(["b", "c", "d", "e"]);
    expect(h.captureType).toHaveLength(WINDOW);
  });

  it("records nothing for an answered key", () => {
    const answered = { captureType: "2026-08-25" };
    const h = recordChoice({}, answered, "captureType", "note");
    expect(h.captureType).toBeUndefined();
  });

  it("does not mutate its input", () => {
    const before: NudgeHistory = { captureType: ["a"] };
    recordChoice(before, NONE, "captureType", "b");
    expect(before.captureType).toEqual(["a"]);
  });
});

describe("nudgeVerdict", () => {
  it("stays quiet with fewer than three choices", () => {
    expect(nudgeVerdict(trail("note", "note"), NONE, "captureType", "task"))
      .toBeNull();
  });

  it("fires on three in a row, before four exist", () => {
    // The spec's exception: a streak of 3 is enough on its own.
    const v = nudgeVerdict(
      trail("note", "note", "note"),
      NONE,
      "captureType",
      "task",
    );
    expect(v).toEqual({ key: "captureType", value: "note" });
  });

  it("stays quiet when the streak IS the default", () => {
    expect(nudgeVerdict(trail("task", "task", "task"), NONE, "captureType", "task"))
      .toBeNull();
  });

  it("fires on three of the last four, no streak needed", () => {
    // note, task, note, note: never 3 in a row, but 3 of the window.
    const v = nudgeVerdict(
      trail("note", "task", "note", "note"),
      NONE,
      "captureType",
      "task",
    );
    // The last three are task-note-note, not a streak; the window clause
    // catches it.
    expect(v).toEqual({ key: "captureType", value: "note" });
  });

  it("fires on the V-V-x-V shape too", () => {
    const v = nudgeVerdict(
      trail("note", "note", "task", "note"),
      NONE,
      "captureType",
      "task",
    );
    expect(v).toEqual({ key: "captureType", value: "note" });
  });

  it("stays quiet on a 2-2 split window", () => {
    expect(
      nudgeVerdict(trail("note", "goal", "note", "goal"), NONE, "captureType", "task"),
    ).toBeNull();
  });

  it("only the last four count, however long the life of the account", () => {
    // Ten notes long ago, then a switch: the old habit must not haunt.
    const h = trail(
      ...Array(10).fill("note"),
      "task",
      "goal",
      "task",
      "task",
    );
    // Window is task,goal,task,task: 3 tasks, and task IS the default.
    expect(nudgeVerdict(h, NONE, "captureType", "task")).toBeNull();
  });

  it("never fires for an answered key, whatever the trail says", () => {
    const answered = { captureType: "2026-08-25" };
    expect(
      nudgeVerdict(trail("note", "note", "note"), answered, "captureType", "task"),
    ).toBeNull();
  });

  it("re-evaluates against the CURRENT default, not the one at record time", () => {
    // Default changed to note (say, in Settings) after the trail formed:
    // suggesting note again would be nonsense.
    const h = trail("note", "note", "note");
    expect(nudgeVerdict(h, NONE, "captureType", "note")).toBeNull();
  });
});

describe("markAnswered", () => {
  it("spends the key and drops its trail", () => {
    const h = trail("note", "note", "note");
    const { history, answered } = markAnswered(h, NONE, "captureType", "2026-08-25");
    expect(answered.captureType).toBe("2026-08-25");
    expect(history.captureType).toBeUndefined();
  });

  it("leaves other keys' trails alone", () => {
    const h: NudgeHistory = { captureType: ["note"], captureDue: ["today"] };
    const { history } = markAnswered(h, NONE, "captureType", "2026-08-25");
    expect(history.captureDue).toEqual(["today"]);
  });

  it("the full life: record, fire, answer, silence", () => {
    let h: NudgeHistory = {};
    let a: NudgeAnswered = {};
    for (const v of ["note", "note", "note"])
      h = recordChoice(h, a, "captureType", v);
    expect(nudgeVerdict(h, a, "captureType", "task")).not.toBeNull();

    ({ history: h, answered: a } = markAnswered(h, a, "captureType", "2026-08-25"));

    // Ten more notes: recorded nowhere, suggested never.
    for (let i = 0; i < 10; i++) h = recordChoice(h, a, "captureType", "note");
    expect(h.captureType).toBeUndefined();
    expect(nudgeVerdict(h, a, "captureType", "task")).toBeNull();
  });
});
