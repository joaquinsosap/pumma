// Somebody else's events, wearing the same clothes as your own.
//
// The decision this file encodes: an imported event is an agenda item. Not a
// parallel list, not a second timeline, not a "calendar layer" you toggle. The
// point of subscribing was to stop having two places to look, and a UI that
// keeps them apart rebuilds the problem it was meant to solve.
//
// What it does NOT do is pretend they are yours. `linkedTo` names the calendar
// an item came from, and every surface uses it to swap the delete control for
// a chain: the item is a reflection of something owned elsewhere, and the only
// honest way to remove it is to unsubscribe.
import type { AgendaItem, CalendarFeed, ExternalEvent } from "@/lib/schemas";

/** An agenda item that may have come from somewhere else. */
export type AgendaEntry = AgendaItem & {
  /** The feed's label when this is a mirror, absent when it is yours. */
  linkedTo?: string;
};

/** Reads as a time on the row, and all-day events do not pretend to have one. */
export const ALL_DAY_LABEL = "all day";

/**
 * External events as agenda items.
 *
 * Feeds that are switched off contribute nothing: disabling one should empty
 * the calendar of its events without throwing away the subscription or its
 * cached rows, so this filters at read time rather than at sync time.
 */
export function externalToAgenda(
  events: ExternalEvent[],
  feeds: CalendarFeed[],
): AgendaEntry[] {
  const byId = new Map(feeds.filter((f) => f.enabled).map((f) => [f.id, f]));
  const out: AgendaEntry[] = [];
  for (const e of events) {
    const feed = byId.get(e.feedId);
    if (!feed) continue;
    out.push({
      id: e.id,
      userId: e.userId,
      time: e.allDay ? ALL_DAY_LABEL : (e.time ?? ""),
      title: e.title,
      // The line under the title is where a calendar's own detail goes: where
      // it is, or failing that what it says it is about.
      sub: e.location || firstLine(e.notes),
      color: feed.color,
      lifeArea: feed.lifeArea,
      date: e.date,
      kind: "meeting",
      durationMins: e.durationMins,
      notes: e.notes,
      recurrence: null,
      // A repeat rule was already expanded into separate rows at sync time, so
      // there is no series here to make exceptions to.
      exceptions: [],
      linkedTo: feed.label,
    });
  }
  return out;
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  return line.trim().slice(0, 140);
}

/** True for the mirrors: they cannot be edited or deleted from inside PUMMA. */
export function isLinked(item: AgendaEntry): boolean {
  return Boolean(item.linkedTo);
}
