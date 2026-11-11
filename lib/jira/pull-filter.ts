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
 * How a pull starts: everybody's tickets, without the finished ones. Bringing
 * a year-old project in should not fill Done with its history, and the Done
 * chip puts them back.
 */
export const pullFilterStart = (): PullFilter => ({
  who: "all",
  stages: new Set<JiraStage>(["todo", "doing"]),
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

/**
 * Every piece of work in the forest, for "None": the tickets go, the epics
 * and top tickets above them stay ticked, so ticking one ticket back is one
 * click and not three.
 */
export function pieceKeys(forest: PullForest): string[] {
  return [
    ...forest.coords.flatMap((c) => c.epics.flatMap((e) => e.stories)),
    ...forest.epics.flatMap((e) => e.stories),
    ...forest.loose,
  ].map((t) => t.key);
}
