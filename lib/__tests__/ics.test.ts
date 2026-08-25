import { describe, expect, it } from "vitest";
import { parseIcs } from "@/lib/ics";

/** Feeds are CRLF-delimited by spec; building them by hand keeps that honest. */
function ics(...lines: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    ...lines,
    "END:VCALENDAR",
  ].join("\r\n");
}

const TZ = "America/Montevideo"; // UTC-3, no DST since 2015

describe("parseIcs", () => {
  it("reads a single timed event into the viewer's zone", () => {
    const { occurrences } = parseIcs(
      ics(
        "BEGIN:VEVENT",
        "UID:a@test",
        "SUMMARY:Standup",
        "DTSTART:20260302T130000Z",
        "DTEND:20260302T133000Z",
        "END:VEVENT",
      ),
      TZ,
      "2026-03-01",
      "2026-03-31",
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]).toMatchObject({
      title: "Standup",
      date: "2026-03-02",
      time: "10:00", // 13:00Z is 10:00 in UTC-3
      durationMins: 30,
      allDay: false,
    });
  });

  it("leaves an all-day event on its own date, with no time", () => {
    // The trap: converting a DATE through a timezone moves it a day for
    // anyone west of the publisher.
    const { occurrences } = parseIcs(
      ics(
        "BEGIN:VEVENT",
        "UID:b@test",
        "SUMMARY:Birthday",
        "DTSTART;VALUE=DATE:20260315",
        "DTEND;VALUE=DATE:20260316",
        "END:VEVENT",
      ),
      "Pacific/Auckland",
      "2026-03-01",
      "2026-03-31",
    );
    expect(occurrences[0]).toMatchObject({
      date: "2026-03-15",
      time: null,
      allDay: true,
    });
  });

  it("expands a weekly rule and stops at the window", () => {
    const { occurrences } = parseIcs(
      ics(
        "BEGIN:VEVENT",
        "UID:c@test",
        "SUMMARY:Weekly",
        "DTSTART:20260302T120000Z",
        "DTEND:20260302T130000Z",
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "END:VEVENT",
      ),
      TZ,
      "2026-03-01",
      "2026-03-31",
    );
    expect(occurrences.map((o) => o.date)).toEqual([
      "2026-03-02",
      "2026-03-09",
      "2026-03-16",
      "2026-03-23",
      "2026-03-30",
    ]);
  });

  it("honours EXDATE", () => {
    const { occurrences } = parseIcs(
      ics(
        "BEGIN:VEVENT",
        "UID:d@test",
        "SUMMARY:Weekly",
        "DTSTART:20260302T120000Z",
        "DTEND:20260302T130000Z",
        "RRULE:FREQ=WEEKLY;BYDAY=MO",
        "EXDATE:20260309T120000Z",
        "END:VEVENT",
      ),
      TZ,
      "2026-03-01",
      "2026-03-31",
    );
    expect(occurrences.map((o) => o.date)).not.toContain("2026-03-09");
  });

  it("applies a RECURRENCE-ID override that moves one instance", () => {
    // The single most-missed feature: one instance of a series moved and
    // renamed, while the rest stay put.
    const { occurrences } = parseIcs(
      ics(
        "BEGIN:VEVENT",
        "UID:e@test",
        "SUMMARY:Weekly",
        "DTSTART:20260302T120000Z",
        "DTEND:20260302T130000Z",
        "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:e@test",
        "RECURRENCE-ID:20260309T120000Z",
        "SUMMARY:Moved to Tuesday",
        "DTSTART:20260310T150000Z",
        "DTEND:20260310T160000Z",
        "END:VEVENT",
      ),
      TZ,
      "2026-03-01",
      "2026-03-31",
    );
    const moved = occurrences.find((o) => o.title === "Moved to Tuesday");
    expect(moved).toBeDefined();
    expect(moved?.date).toBe("2026-03-10");
    expect(moved?.time).toBe("12:00");
    // and the instance it replaced is gone
    expect(occurrences.filter((o) => o.date === "2026-03-09")).toHaveLength(0);
  });

  it("resolves a TZID against the feed's own VTIMEZONE", () => {
    const { occurrences } = parseIcs(
      ics(
        "BEGIN:VTIMEZONE",
        "TZID:Europe/Madrid",
        "BEGIN:STANDARD",
        "DTSTART:19701025T030000",
        "TZOFFSETFROM:+0200",
        "TZOFFSETTO:+0100",
        "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
        "END:STANDARD",
        "BEGIN:DAYLIGHT",
        "DTSTART:19700329T020000",
        "TZOFFSETFROM:+0100",
        "TZOFFSETTO:+0200",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
        "END:DAYLIGHT",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "UID:f@test",
        "SUMMARY:Madrid lunch",
        "DTSTART;TZID=Europe/Madrid:20260702T140000",
        "DTEND;TZID=Europe/Madrid:20260702T150000",
        "END:VEVENT",
      ),
      TZ,
      "2026-07-01",
      "2026-07-31",
    );
    // July is CEST (+2), so 14:00 Madrid is 12:00Z is 09:00 in UTC-3.
    expect(occurrences[0]).toMatchObject({
      date: "2026-07-02",
      time: "09:00",
    });
  });

  it("unfolds long lines rather than truncating them", () => {
    const long = ics(
      "BEGIN:VEVENT",
      "UID:g@test",
      "SUMMARY:A title long enough that a publisher will fold it across tw",
      " o lines",
      "DTSTART:20260302T130000Z",
      "DTEND:20260302T133000Z",
      "END:VEVENT",
    );
    const { occurrences } = parseIcs(long, TZ, "2026-03-01", "2026-03-31");
    expect(occurrences[0].title).toBe(
      "A title long enough that a publisher will fold it across two lines",
    );
  });

  it("keeps cancelled events, flagged, so a sync can tombstone them", () => {
    const { occurrences } = parseIcs(
      ics(
        "BEGIN:VEVENT",
        "UID:h@test",
        "SUMMARY:Called off",
        "STATUS:CANCELLED",
        "DTSTART:20260302T130000Z",
        "DTEND:20260302T133000Z",
        "END:VEVENT",
      ),
      TZ,
      "2026-03-01",
      "2026-03-31",
    );
    expect(occurrences[0].cancelled).toBe(true);
  });

  it("gives every occurrence of a series its own key", () => {
    const { occurrences } = parseIcs(
      ics(
        "BEGIN:VEVENT",
        "UID:i@test",
        "SUMMARY:Weekly",
        "DTSTART:20260302T120000Z",
        "DTEND:20260302T130000Z",
        "RRULE:FREQ=WEEKLY;COUNT=3",
        "END:VEVENT",
      ),
      TZ,
      "2026-03-01",
      "2026-03-31",
    );
    const keys = new Set(occurrences.map((o) => o.key));
    expect(keys.size).toBe(occurrences.length);
    expect(new Set(occurrences.map((o) => o.uid)).size).toBe(1);
  });

  it("reads the feed's published name", () => {
    const { calendarName } = parseIcs(
      ics("X-WR-CALNAME:Work", "BEGIN:VEVENT", "UID:j@test",
          "SUMMARY:x", "DTSTART:20260302T130000Z", "END:VEVENT"),
      TZ,
      "2026-03-01",
      "2026-03-31",
    );
    expect(calendarName).toBe("Work");
  });

  it("throws on something that is not a calendar at all", () => {
    expect(() => parseIcs("<html>nope</html>", TZ, "2026-03-01", "2026-03-31"))
      .toThrow(/Not a calendar feed/);
  });

  it("defaults a missing DTEND to a short block rather than a whole day", () => {
    const { occurrences } = parseIcs(
      ics(
        "BEGIN:VEVENT",
        "UID:k@test",
        "SUMMARY:No end",
        "DTSTART:20260302T130000Z",
        "END:VEVENT",
      ),
      TZ,
      "2026-03-01",
      "2026-03-31",
    );
    expect(occurrences[0].durationMins).toBe(30);
  });
});
