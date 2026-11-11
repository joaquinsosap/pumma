// Narrowing a pull: what the selectors hide, and what is left out of a bring-in.
import { describe, expect, it } from "vitest";
import type { JiraStage } from "@/lib/jira/issue";
import {
  narrowPull,
  pullFilterStart,
  settleTicks,
  tickKeys,
  tickOf,
  ticksUnder,
  toggleTick,
  type PullFilter,
} from "@/lib/jira/pull-filter";
import {
  countPlan,
  planPull,
  type PullForest,
  type PulledTicket,
} from "@/lib/jira/pull-plan";

const ticket = (
  key: string,
  over: Partial<PulledTicket> = {},
): PulledTicket => ({
  key,
  title: `Title of ${key}`,
  stage: "todo",
  url: `https://desk.example.com/browse/${key}`,
  mine: false,
  finished: null,
  ...over,
});

const TOP = ticket("PROJ-1");
const CHECKOUT = ticket("PROJ-10");
const SEARCH = ticket("PROJ-20");
const PRICE = ticket("PROJ-11", { stage: "doing", mine: true });
const CARDS = ticket("PROJ-12");
const RECEIPT = ticket("PROJ-13", { stage: "done", mine: true });
const INDEX = ticket("PROJ-21");
const CHORE = ticket("PROJ-90", { mine: true });

const FOREST: PullForest = {
  coords: [
    {
      ticket: TOP,
      epics: [
        { ticket: CHECKOUT, stories: [PRICE, CARDS, RECEIPT] },
        { ticket: SEARCH, stories: [INDEX] },
      ],
    },
  ],
  epics: [],
  loose: [CHORE],
};

const every = (who: PullFilter["who"] = "all"): PullFilter => ({
  who,
  stages: new Set<JiraStage>(["todo", "doing", "done"]),
});
const open: PullFilter = { who: "all", stages: new Set<JiraStage>(["todo", "doing"]) };
const NO_TICKS: ReadonlySet<string> = new Set();
const NO_SKIP: ReadonlySet<string> = new Set();
const sorted = (keys: ReadonlySet<string>) => [...keys].sort();

describe("narrowPull, the selectors", () => {
  it("starts with everybody's tickets at every stage, so all of it arrives ticked", () => {
    const { hidden, off } = narrowPull(FOREST, pullFilterStart(), NO_TICKS);
    expect(sorted(hidden)).toEqual([]);
    expect(sorted(off)).toEqual([]);
  });

  it("takes the finished ones away when Done is turned off", () => {
    const { hidden, off } = narrowPull(FOREST, open, NO_TICKS);
    expect(sorted(hidden)).toEqual(["PROJ-13"]);
    expect(sorted(off)).toEqual(["PROJ-13"]);
  });

  it("hides nothing when every stage is on and everybody's are wanted", () => {
    const { hidden, off } = narrowPull(FOREST, every(), NO_TICKS);
    expect(sorted(hidden)).toEqual([]);
    expect(sorted(off)).toEqual([]);
  });

  it("keeps only the owner's tickets when only theirs are wanted", () => {
    const { hidden } = narrowPull(FOREST, every("mine"), NO_TICKS);
    // Somebody else's tickets, and the epic that held nothing else.
    expect(sorted(hidden)).toEqual(["PROJ-12", "PROJ-20", "PROJ-21"]);
  });

  it("takes an epic away with its last ticket, and the top ticket with its last epic", () => {
    const onlyDone: PullFilter = { who: "all", stages: new Set<JiraStage>(["done"]) };
    const { hidden } = narrowPull(FOREST, onlyDone, NO_TICKS);
    expect(hidden.has("PROJ-20")).toBe(true);
    expect(hidden.has("PROJ-10")).toBe(false);
    expect(hidden.has("PROJ-1")).toBe(false);

    const none: PullFilter = { who: "all", stages: new Set<JiraStage>() };
    expect(sorted(narrowPull(FOREST, none, NO_TICKS).hidden)).toEqual([
      "PROJ-1",
      "PROJ-10",
      "PROJ-11",
      "PROJ-12",
      "PROJ-13",
      "PROJ-20",
      "PROJ-21",
      "PROJ-90",
    ]);
  });

  it("shows a ticket Jira gave no stage for, whichever stages are picked", () => {
    const forest: PullForest = { coords: [], epics: [], loose: [ticket("PROJ-5", { stage: null })] };
    const none: PullFilter = { who: "all", stages: new Set<JiraStage>() };
    expect(sorted(narrowPull(forest, none, NO_TICKS).hidden)).toEqual([]);
  });

  it("keeps an epic nothing was read under, unless only the owner's are wanted and it is not theirs", () => {
    const forest: PullForest = {
      coords: [],
      epics: [
        { ticket: ticket("PROJ-30"), stories: [] },
        { ticket: ticket("PROJ-31", { mine: true }), stories: [] },
      ],
      loose: [],
    };
    expect(sorted(narrowPull(forest, every(), NO_TICKS).hidden)).toEqual([]);
    expect(sorted(narrowPull(forest, every("mine"), NO_TICKS).hidden)).toEqual(["PROJ-30"]);
  });

  it("always keeps a top ticket that was read on its own", () => {
    const alone: PullForest = { coords: [{ ticket: TOP, epics: [] }], epics: [], loose: [] };
    const { hidden, off } = narrowPull(alone, every("mine"), NO_TICKS);
    expect(sorted(hidden)).toEqual([]);
    expect(sorted(off)).toEqual([]);
  });
});

describe("narrowPull, the ticks", () => {
  it("leaves an unticked ticket out without hiding it", () => {
    const { hidden, off } = narrowPull(FOREST, every(), new Set(["PROJ-12"]));
    expect(sorted(hidden)).toEqual([]);
    expect(sorted(off)).toEqual(["PROJ-12"]);
  });

  it("leaves an epic out once every ticket under it is unticked, and still draws it", () => {
    const { hidden, off } = narrowPull(FOREST, every(), new Set(["PROJ-21"]));
    expect(hidden.has("PROJ-20")).toBe(false);
    expect(sorted(off)).toEqual(["PROJ-20", "PROJ-21"]);
  });

  it("counts a hidden ticket as gone when deciding whether an epic has anything left", () => {
    // Checkout's only open ticket that is not hidden is unticked: nothing of it comes in.
    const { off } = narrowPull(FOREST, open, new Set(["PROJ-11", "PROJ-12"]));
    expect(off.has("PROJ-10")).toBe(true);
    expect(off.has("PROJ-1")).toBe(false);
  });

  it("leaves the top ticket out when nothing under it is left", () => {
    const { off } = narrowPull(FOREST, every(), new Set(tickKeys(FOREST)));
    expect(off.has("PROJ-1")).toBe(true);
  });

  it("brings a ticket back with one tick after None: its epic and top ticket come with it", () => {
    const unticked = toggleTick(FOREST, "PROJ-21", new Set(tickKeys(FOREST)), NO_SKIP);
    const { off } = narrowPull(FOREST, every(), unticked);
    expect(off.has("PROJ-21")).toBe(false);
    expect(off.has("PROJ-20")).toBe(false);
    expect(off.has("PROJ-1")).toBe(false);
    expect(off.has("PROJ-10")).toBe(true);
  });

  it("names every row with a tick of its own for None: the work, and an epic or top ticket nothing was read under", () => {
    expect(tickKeys(FOREST).sort()).toEqual([
      "PROJ-11",
      "PROJ-12",
      "PROJ-13",
      "PROJ-21",
      "PROJ-90",
    ]);
    const bare: PullForest = {
      coords: [{ ticket: TOP, epics: [] }],
      epics: [{ ticket: ticket("PROJ-30"), stories: [] }],
      loose: [],
    };
    expect(tickKeys(bare).sort()).toEqual(["PROJ-1", "PROJ-30"]);
  });
});

describe("the boxes", () => {
  it("stands a row for everything under it, and a piece of work for itself", () => {
    expect(ticksUnder(FOREST, "PROJ-1").sort()).toEqual(["PROJ-11", "PROJ-12", "PROJ-13", "PROJ-21"]);
    expect(ticksUnder(FOREST, "PROJ-10").sort()).toEqual(["PROJ-11", "PROJ-12", "PROJ-13"]);
    expect(ticksUnder(FOREST, "PROJ-12")).toEqual(["PROJ-12"]);
  });

  it("ticks a row when all under it are ticked, dashes it when some are, empties it when none are", () => {
    expect(tickOf(FOREST, "PROJ-10", NO_TICKS, NO_SKIP)).toBe("on");
    expect(tickOf(FOREST, "PROJ-10", new Set(["PROJ-12"]), NO_SKIP)).toBe("some");
    expect(tickOf(FOREST, "PROJ-1", new Set(["PROJ-12"]), NO_SKIP)).toBe("some");
    expect(tickOf(FOREST, "PROJ-10", new Set(["PROJ-11", "PROJ-12", "PROJ-13"]), NO_SKIP)).toBe("off");
  });

  it("empties every box after None, the epics and the top ticket too", () => {
    const none = new Set(tickKeys(FOREST));
    for (const key of ["PROJ-1", "PROJ-10", "PROJ-20", "PROJ-11", "PROJ-21", "PROJ-90"]) {
      expect(tickOf(FOREST, key, none, NO_SKIP)).toBe("off");
    }
  });

  it("unticks everything under an epic with one click, and ticks it all back with the next", () => {
    const off = toggleTick(FOREST, "PROJ-10", NO_TICKS, NO_SKIP);
    expect(sorted(off)).toEqual(["PROJ-11", "PROJ-12", "PROJ-13"]);
    expect(sorted(toggleTick(FOREST, "PROJ-10", off, NO_SKIP))).toEqual([]);
  });

  it("ticks the rest when a half-ticked row is clicked", () => {
    expect(sorted(toggleTick(FOREST, "PROJ-10", new Set(["PROJ-12"]), NO_SKIP))).toEqual([]);
  });

  it("reaches every ticket under its epics from the top ticket", () => {
    expect(sorted(toggleTick(FOREST, "PROJ-1", NO_TICKS, NO_SKIP))).toEqual([
      "PROJ-11",
      "PROJ-12",
      "PROJ-13",
      "PROJ-21",
    ]);
  });

  it("reads a box from the rows that can be ticked: not the hidden ones, not the ones already here", () => {
    const skip = new Set(["PROJ-13"]);
    expect(tickOf(FOREST, "PROJ-10", new Set(["PROJ-13"]), skip)).toBe("on");
    expect(tickOf(FOREST, "PROJ-13", NO_TICKS, skip)).toBe("none");
  });

  it("lets an epic whose every ticket is already here be left out, so no empty tag or project is made", () => {
    // Search's only ticket is a task here already: the epic is all there is to decide.
    const skip = new Set(["PROJ-21"]);
    const have = { tasks: new Set(["PROJ-21"]), projects: new Set<string>() };
    expect(tickOf(FOREST, "PROJ-20", NO_TICKS, skip)).toBe("on");
    const kept = narrowPull(FOREST, every(), NO_TICKS);
    expect(planPull(FOREST, "epic", kept.off, have).projects.map((p) => p.from?.key)).toContain("PROJ-20");

    const left = toggleTick(FOREST, "PROJ-20", NO_TICKS, skip);
    expect(sorted(left)).toEqual(["PROJ-20"]);
    expect(tickOf(FOREST, "PROJ-20", left, skip)).toBe("off");
    const out = narrowPull(FOREST, every(), left);
    expect(planPull(FOREST, "epic", out.off, have).projects.map((p) => p.from?.key)).not.toContain("PROJ-20");
    // The next click puts it back.
    expect(sorted(toggleTick(FOREST, "PROJ-20", left, skip))).toEqual([]);
  });

  it("unticks such an epic with None too", () => {
    expect(tickKeys(FOREST, new Set(["PROJ-21"]))).toContain("PROJ-20");
    expect(tickKeys(FOREST)).not.toContain("PROJ-20");
  });

  it("drops an epic's own untick once a ticket under it can be ticked again", () => {
    // Left out while its ticket was hidden; the stage comes back on.
    const left = new Set(["PROJ-20"]);
    expect(sorted(settleTicks(FOREST, left, new Set(["PROJ-21"])))).toEqual(["PROJ-20"]);
    expect(sorted(settleTicks(FOREST, left, NO_SKIP))).toEqual([]);
    // A piece of work's untick is its own and stays.
    expect(sorted(settleTicks(FOREST, new Set(["PROJ-12"]), NO_SKIP))).toEqual(["PROJ-12"]);
  });

  it("takes an epic's hidden tickets with it, so a stage turned back on shows it as it was left", () => {
    const skip = new Set(["PROJ-13"]);
    expect(sorted(toggleTick(FOREST, "PROJ-10", NO_TICKS, skip))).toEqual(["PROJ-11", "PROJ-12", "PROJ-13"]);
  });

  it("gives an epic nothing was read under a tick of its own", () => {
    const bare: PullForest = { coords: [], epics: [{ ticket: ticket("PROJ-30"), stories: [] }], loose: [] };
    const off = toggleTick(bare, "PROJ-30", NO_TICKS, NO_SKIP);
    expect(sorted(off)).toEqual(["PROJ-30"]);
    expect(tickOf(bare, "PROJ-30", off, NO_SKIP)).toBe("off");
    expect(narrowPull(bare, every(), off).off.has("PROJ-30")).toBe(true);
  });
});

describe("narrowPull, handed to the plan", () => {
  const nothingHere = { tasks: new Set<string>(), projects: new Set<string>() };

  it("makes no tag for an epic the selectors emptied", () => {
    const { off } = narrowPull(FOREST, every("mine"), NO_TICKS);
    const plan = planPull(FOREST, "coord", off, nothingHere);
    expect(countPlan(plan)).toEqual({ projects: 1, tags: 1, tasks: 3 });
  });

  it("makes no project when only the owner's are wanted and none under it is theirs", () => {
    const theirs: PullForest = {
      coords: [{ ticket: TOP, epics: [{ ticket: SEARCH, stories: [INDEX] }] }],
      epics: [],
      loose: [],
    };
    const { off } = narrowPull(theirs, every("mine"), NO_TICKS);
    const plan = planPull(theirs, "coord", off, nothingHere);
    expect(countPlan(plan)).toEqual({ projects: 0, tags: 0, tasks: 0 });
  });
});
