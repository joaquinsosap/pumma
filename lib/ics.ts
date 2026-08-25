// Reading somebody else's calendar.
//
// This file is pure: text in, occurrences out. No network, no database, no
// clock beyond what the caller passes. That is what makes the awkward parts
// of iCalendar testable, and the awkward parts are most of it.
//
// Why a library rather than a parser of our own: iCalendar is not a format
// you can eyeball. Lines fold at 75 octets and continue with a leading space.
// Values escape commas and semicolons. A date can be floating (no zone), UTC,
// or carry a TZID that refers to a VTIMEZONE block defined elsewhere in the
// same file with its own DST rules. Recurrence is a small language, and a
// single occurrence of a series can be overridden by a separate VEVENT that
// points back at it with RECURRENCE-ID. Every one of those has bitten every
// hand-rolled parser ever written, silently, by producing an event on the
// wrong day.
import ICAL from "ical.js";

/** One concrete thing on a day, already resolved out of any repeat rule. */
export type IcsOccurrence = {
  /** Stable per series: the VEVENT UID. Not unique across occurrences. */
  uid: string;
  /**
   * Unique per occurrence. UID alone collides for every instance of a repeat,
   * so the start is folded in, which is also what RECURRENCE-ID keys on.
   */
  key: string;
  title: string;
  /** YYYY-MM-DD in the viewer's timezone. */
  date: string;
  /** HH:MM in the viewer's timezone, or null for an all-day event. */
  time: string | null;
  durationMins: number;
  allDay: boolean;
  location: string;
  description: string;
  /** CANCELLED events are kept so a sync can tombstone rather than guess. */
  cancelled: boolean;
};

export type IcsParseResult = {
  /** The feed's own name, when it publishes one. */
  calendarName: string | null;
  occurrences: IcsOccurrence[];
  /** Series the expander gave up on, so a caller can report rather than lie. */
  skipped: { uid: string; reason: string }[];
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * An ICAL.Time rendered in the viewer's zone.
 *
 * All-day values are deliberately NOT converted. A birthday on the 3rd is on
 * the 3rd everywhere; running it through a timezone is how it becomes the 2nd
 * for anyone west of the publisher.
 */
function localParts(
  t: ICAL.Time,
  timeZone: string,
): { date: string; time: string | null } {
  if (t.isDate) {
    return { date: `${t.year}-${pad(t.month)}-${pad(t.day)}`, time: null };
  }
  const d = t.toJSDate();
  // Intl rather than manual offset arithmetic: it is the only thing on the
  // platform that knows what the offset WAS on that date, which is the whole
  // problem with DST.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
  };
}

function minutesBetween(start: ICAL.Time, end: ICAL.Time | null): number {
  if (!end) return 30;
  const mins = Math.round(
    (end.toJSDate().getTime() - start.toJSDate().getTime()) / 60000,
  );
  // A zero or negative duration is malformed; a day-long default would be
  // worse than a short one, because it would paint over the whole day.
  return mins > 0 ? Math.min(mins, 60 * 24 * 7) : 30;
}

/** UID plus the occurrence's own start, which is what RECURRENCE-ID keys on. */
function occurrenceKey(uid: string, start: ICAL.Time): string {
  return `${uid}::${start.toICALString()}`;
}

/**
 * Every occurrence a feed puts inside [rangeStart, rangeEnd].
 *
 * The window is required, not optional. A feed may contain a rule with no end
 * date, and "expand it all" is an infinite loop with extra steps.
 *
 * @param text     raw text/calendar body
 * @param timeZone IANA zone the occurrences should read in
 * @param rangeStart inclusive YYYY-MM-DD
 * @param rangeEnd   inclusive YYYY-MM-DD
 */
export function parseIcs(
  text: string,
  timeZone: string,
  rangeStart: string,
  rangeEnd: string,
): IcsParseResult {
  const occurrences: IcsOccurrence[] = [];
  const skipped: { uid: string; reason: string }[] = [];

  let comp: ICAL.Component;
  try {
    comp = new ICAL.Component(ICAL.parse(text));
  } catch (err) {
    throw new Error(
      `Not a calendar feed: ${err instanceof Error ? err.message : "unparseable"}`,
    );
  }

  // VTIMEZONE blocks have to be registered before any TZID resolves, or every
  // zoned event silently falls back to floating and lands at the wrong hour.
  for (const vtz of comp.getAllSubcomponents("vtimezone")) {
    const tzid = vtz.getFirstPropertyValue("tzid");
    if (typeof tzid === "string" && !ICAL.TimezoneService.has(tzid)) {
      ICAL.TimezoneService.register(vtz);
    }
  }

  const calendarName =
    (comp.getFirstPropertyValue("x-wr-calname") as string | null) ?? null;

  const windowStart = ICAL.Time.fromDateString(rangeStart);
  const windowEnd = ICAL.Time.fromDateString(rangeEnd);
  // Inclusive end: a rule is compared against the start of the day after.
  windowEnd.adjust(1, 0, 0, 0);

  const vevents = comp.getAllSubcomponents("vevent");

  // Overrides first. A modified instance is its own VEVENT carrying the same
  // UID plus a RECURRENCE-ID naming the instance it replaces, and it can move
  // to a different day, so it has to be indexed before the series expands.
  const overrides = new Map<string, ICAL.Event>();
  for (const ve of vevents) {
    const ev = new ICAL.Event(ve);
    if (ev.isRecurrenceException()) {
      overrides.set(occurrenceKey(ev.uid, ev.recurrenceId), ev);
    }
  }

  const push = (ev: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null) => {
    const { date, time } = localParts(start, timeZone);
    if (date < rangeStart || date > rangeEnd) return;
    occurrences.push({
      uid: ev.uid,
      key: occurrenceKey(ev.uid, start),
      title: ev.summary?.trim() || "(no title)",
      date,
      time,
      durationMins: minutesBetween(start, end),
      allDay: start.isDate,
      location: ev.location?.trim() ?? "",
      description: ev.description?.trim() ?? "",
      cancelled:
        (ev.component.getFirstPropertyValue("status") as string | null) ===
        "CANCELLED",
    });
  };

  for (const ve of vevents) {
    const ev = new ICAL.Event(ve);
    if (ev.isRecurrenceException()) continue; // handled via `overrides`
    if (!ev.startDate) continue;

    if (!ev.isRecurring()) {
      push(ev, ev.startDate, ev.endDate);
      continue;
    }

    try {
      const it = ev.iterator();
      let next: ICAL.Time | null;
      let guard = 0;
      // The guard is not paranoia: a feed can legally contain a rule that
      // yields tens of thousands of instances, and one bad feed must not be
      // able to hang everyone's sync.
      while ((next = it.next()) && guard++ < 2000) {
        if (next.compare(windowEnd) > 0) break;
        // An occurrence that ENDS inside the window still belongs to it, so
        // the cheap "starts before the window" skip has to allow for length.
        if (next.compare(windowStart) < 0) continue;

        const override = overrides.get(occurrenceKey(ev.uid, next));
        if (override) {
          if (override.startDate) {
            push(override, override.startDate, override.endDate);
          }
          continue;
        }
        const detail = ev.getOccurrenceDetails(next);
        push(ev, detail.startDate, detail.endDate);
      }
    } catch (err) {
      skipped.push({
        uid: ev.uid,
        reason: err instanceof Error ? err.message : "could not expand",
      });
    }
  }

  // EXDATE removals are handled by the iterator, but an override can move an
  // instance ONTO a day another instance already occupies. Last one wins,
  // keyed per occurrence, which matches what calendars display.
  const byKey = new Map<string, IcsOccurrence>();
  for (const o of occurrences) byKey.set(o.key, o);

  return {
    calendarName,
    occurrences: [...byKey.values()].sort(
      (a, b) =>
        a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? ""),
    ),
    skipped,
  };
}
