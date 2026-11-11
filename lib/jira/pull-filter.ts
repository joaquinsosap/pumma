// Narrowing what a pull read, before any of it is brought in.
//
// The tree shows what Jira gave. Two small selectors cut it down: whose
// tickets (everybody's, or only the owner's) and where they stand (to do, in
// progress, done). Ticks cut it further, one ticket at a time.
//
// This file is only the rule: given the selectors and the ticks, which
// tickets are not drawn and which are not brought in. Nothing here asks Jira
// anything, so changing a selector costs no request.

import type { JiraStage } from "@/lib/jira/issue";
import type { PullForest, PulledEpic, PulledTicket } from "@/lib/jira/pull-plan";

export type PullWho = "all" | "mine";

export type PullFilter = {
  who: PullWho;
  /** The stages shown. A ticket Jira gave no stage for is shown whichever are picked. */
  stages: ReadonlySet<JiraStage>;
};

/**
 * How a pull starts: everybody's tickets, at every stage. All of it arrives
 * ticked and the owner unticks what is not wanted; a stage chip takes a whole
 * stage away in one click.
 */
export const pullFilterStart = (): PullFilter => ({
  who: "all",
  stages: new Set<JiraStage>(["todo", "doing", "done"]),
});

export type Narrowed = {
  /** Not drawn: the selectors left them out. */
  hidden: ReadonlySet<string>;
  /**
   * Not brought in: hidden, unticked, or an epic or top ticket with nothing
   * left under it. This is the list the server is sent, so the line under the
   * tree and what "Bring in" does are worked out from the same thing.
   */
  off: ReadonlySet<string>;
};

/** Whether a piece of work gets past the selectors. */
function passes(ticket: PulledTicket, filter: PullFilter): boolean {
  if (filter.who === "mine" && !ticket.mine) return false;
  return ticket.stage === null || filter.stages.has(ticket.stage);
}

/**
 * What the selectors and the ticks leave out of `forest`.
 *
 * An epic goes with its last ticket, and a top ticket with its last epic: a
 * tag or a project with nothing in it is not what anybody narrowed down to.
 * An epic nothing was read under has no ticket to speak for it, so it stays,
 * unless only the owner's are wanted and it is not theirs. The same goes for a
 * top ticket read on its own, which always stays: it is what was asked for.
 */
export function narrowPull(
  forest: PullForest,
  filter: PullFilter,
  unticked: ReadonlySet<string>,
): Narrowed {
  const hidden = new Set<string>();
  const off = new Set<string>(unticked);

  const piece = (ticket: PulledTicket): { shown: boolean; comes: boolean } => {
    const shown = passes(ticket, filter);
    if (!shown) {
      hidden.add(ticket.key);
      off.add(ticket.key);
    }
    return { shown, comes: shown && !unticked.has(ticket.key) };
  };

  const epic = (e: PulledEpic): { shown: boolean; comes: boolean } => {
    const under = e.stories.map(piece);
    const shown =
      under.length > 0
        ? under.some((s) => s.shown)
        : filter.who === "all" || e.ticket.mine;
    const comes =
      shown &&
      !unticked.has(e.ticket.key) &&
      (under.length === 0 || under.some((s) => s.comes));
    if (!shown) hidden.add(e.ticket.key);
    if (!comes) off.add(e.ticket.key);
    return { shown, comes };
  };

  for (const coord of forest.coords) {
    const under = coord.epics.map(epic);
    if (under.length === 0) continue;
    if (!under.some((e) => e.shown)) hidden.add(coord.ticket.key);
    if (!under.some((e) => e.comes)) off.add(coord.ticket.key);
  }
  forest.epics.forEach(epic);
  forest.loose.forEach(piece);

  return { hidden, off };
}

// The ticks. A piece of work holds a tick of its own, and so does an epic or
// a top ticket nothing was read under. A row with rows under it holds none:
// its box shows theirs, and a click on it ticks or unticks all of them.

const epicTicks = (e: PulledEpic): string[] =>
  e.stories.length > 0 ? e.stories.map((s) => s.key) : [e.ticket.key];
const coordTicks = (c: PullForest["coords"][number]): string[] =>
  c.epics.length > 0 ? c.epics.flatMap(epicTicks) : [c.ticket.key];

/** Every row that holds a tick of its own, for "None". */
export function tickKeys(forest: PullForest): string[] {
  return [
    ...forest.coords.flatMap(coordTicks),
    ...forest.epics.flatMap(epicTicks),
    ...forest.loose.map((t) => t.key),
  ];
}

/** The ticks a row stands for: its own, or those of everything under it. */
export function ticksUnder(forest: PullForest, key: string): string[] {
  for (const c of forest.coords) {
    if (c.ticket.key === key) return coordTicks(c);
    for (const e of c.epics) if (e.ticket.key === key) return epicTicks(e);
  }
  for (const e of forest.epics) if (e.ticket.key === key) return epicTicks(e);
  return [key];
}

/** What a row's box shows. "none": nothing it stands for can be ticked. */
export type Tick = "on" | "off" | "some" | "none";

/**
 * A row's box. `skip` holds the rows that cannot be ticked: the ones the
 * selectors hid, and the ones a task here already holds.
 */
export function tickOf(
  forest: PullForest,
  key: string,
  unticked: ReadonlySet<string>,
  skip: ReadonlySet<string>,
): Tick {
  const live = ticksUnder(forest, key).filter((k) => !skip.has(k));
  if (live.length === 0) return "none";
  const on = live.filter((k) => !unticked.has(k)).length;
  if (on === 0) return "off";
  return on === live.length ? "on" : "some";
}

/**
 * A click on a row's box. A row with rows under it unticks them all once
 * every one it shows is ticked, and ticks them all otherwise, the hidden ones
 * with them: a stage turned back on shows the epic the way it was left.
 */
export function toggleTick(
  forest: PullForest,
  key: string,
  unticked: ReadonlySet<string>,
  skip: ReadonlySet<string>,
): Set<string> {
  const untick = tickOf(forest, key, unticked, skip) === "on";
  const next = new Set(unticked);
  for (const k of ticksUnder(forest, key)) {
    if (untick) next.add(k);
    else next.delete(k);
  }
  return next;
}
