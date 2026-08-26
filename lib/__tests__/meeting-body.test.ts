import { describe, expect, it } from "vitest";
import {
  cleanMeetingText,
  extractDetails,
  findConferenceLink,
  parseMeetingBody,
  unwrapSafelink,
} from "@/lib/meeting-body";

// Shaped like a real Teams invite — the angle-bracket anchors, the safelinks
// wrapper, the underscore rules, the boilerplate footer — with every value
// invented. This repo is public; a real invite carries a work address, a
// tenant id, a meeting id and a passcode, and none of those belong in git.
const TEAMS_INVITE = [
  "________________________________________________________________________________",
  "Microsoft Teams meeting",
  "Join: https://teams.microsoft.com/meet/000000000000?p=aaaaaaaaaaaa<https://eur03.safelinks.protection.outlook.com/ap/t-00000000/?url=https%3A%2F%2Fteams.microsoft.com%2Fmeet%2F000000000000%3Fp%3Daaaaaaaaaaaa&data=05%7C02%7Cexample%40example.com%7C0000&sdata=xxxx&reserved=0>",
  "Meeting ID: 000 000 000 000",
  "Passcode: aa0aa0aa",
  "________________________________",
  "Need help?<https://eur03.safelinks.protection.outlook.com/?url=https%3A%2F%2Faka.ms%2FJoinTeamsMeeting&data=05%7C02%7C0000>",
  "| System reference<https://eur03.safelinks.protection.outlook.com/ap/t-00000000/?url=https%3A%2F%2Fteams.microsoft.com%2Fl%2Fmeetup-join%2F19%253ameeting_x%2540thread.v2%2F0&data=05>",
  "For organizers: Meeting options<https://eur03.safelinks.protection.outlook.com/?url=https%3A%2F%2Fteams.microsoft.com%2FmeetingOptions%2F&data=05>",
  "________________________________________________________________________________",
].join("\n");

describe("unwrapSafelink", () => {
  it("returns the destination hidden in the url parameter", () => {
    const wrapped =
      "https://eur03.safelinks.protection.outlook.com/ap/t-00000000/?url=https%3A%2F%2Fteams.microsoft.com%2Fmeet%2F123%3Fp%3Dxyz&data=05";
    expect(unwrapSafelink(wrapped)).toBe(
      "https://teams.microsoft.com/meet/123?p=xyz",
    );
  });

  it("leaves an ordinary URL alone", () => {
    const plain = "https://teams.microsoft.com/meet/123";
    expect(unwrapSafelink(plain)).toBe(plain);
  });

  it("does not throw on something that is not a URL", () => {
    expect(unwrapSafelink("not a url")).toBe("not a url");
  });
});

describe("findConferenceLink", () => {
  it("finds the Teams join link in a real-shaped invite", () => {
    const link = findConferenceLink(TEAMS_INVITE);
    expect(link?.kind).toBe("teams");
    expect(link?.url).toBe(
      "https://teams.microsoft.com/meet/000000000000?p=aaaaaaaaaaaa",
    );
  });

  it("takes the JOIN link, not the help page", () => {
    // aka.ms/JoinTeamsMeeting appears first in some invites and is a support
    // article, so a naive "first teams-ish URL" picks the wrong one.
    const link = findConferenceLink(TEAMS_INVITE);
    expect(link?.url).not.toMatch(/aka\.ms/);
  });

  it("finds Zoom, including the passcode-bearing form", () => {
    const link = findConferenceLink(
      "Join Zoom Meeting\nhttps://us02web.zoom.us/j/1234567890?pwd=Abc123\n",
    );
    expect(link).toMatchObject({
      kind: "zoom",
      url: "https://us02web.zoom.us/j/1234567890?pwd=Abc123",
    });
  });

  it("finds Google Meet", () => {
    const link = findConferenceLink(
      "Video call link: https://meet.google.com/abc-defg-hij",
    );
    expect(link).toMatchObject({ kind: "meet" });
  });

  it("finds Webex", () => {
    expect(
      findConferenceLink("https://acme.webex.com/meet/someone")?.kind,
    ).toBe("webex");
  });

  it("returns null when a meeting is just a meeting", () => {
    expect(findConferenceLink("Coffee with Sam, downstairs")).toBeNull();
    expect(findConferenceLink("")).toBeNull();
  });

  it("does not mistake an ordinary link for a conference", () => {
    expect(
      findConferenceLink("Agenda: https://example.com/notes/q3"),
    ).toBeNull();
  });
});

describe("extractDetails", () => {
  it("pulls the ID and passcode out of the wall", () => {
    expect(extractDetails(TEAMS_INVITE)).toEqual([
      { label: "Meeting ID", value: "000 000 000 000" },
      { label: "Passcode", value: "aa0aa0aa" },
    ]);
  });

  it("finds nothing in a body that has nothing", () => {
    expect(extractDetails("Standup")).toEqual([]);
  });
});

describe("cleanMeetingText", () => {
  const cleaned = cleanMeetingText(TEAMS_INVITE);

  it("keeps no URLs at all", () => {
    expect(cleaned).not.toMatch(/https?:\/\//);
  });

  it("keeps no safelinks tracking", () => {
    expect(cleaned).not.toMatch(/safelinks|sdata=|reserved=0/);
  });

  it("drops the underscore rules", () => {
    expect(cleaned).not.toMatch(/_{4,}/);
  });

  it("drops the boilerplate footer", () => {
    expect(cleaned).not.toMatch(/Need help|System reference|For organizers/i);
  });

  it("collapses to something a person would read", () => {
    // Blank lines are allowed: they are paragraph breaks. What must not
    // survive is a line of leftover punctuation, or the sheer bulk.
    const lines = cleaned.split("\n").filter((l) => l.trim());
    expect(lines.every((l) => !/^[|\u00b7\u2022:,.\-]+$/.test(l.trim()))).toBe(true);
    expect(cleaned.length).toBeLessThan(120);
  });

  it("leaves a human-written body untouched", () => {
    const human = "Bring the Q3 numbers.\n\nWe start with the roadmap.";
    expect(cleanMeetingText(human)).toBe(human);
  });

  it("survives an empty body", () => {
    expect(cleanMeetingText("")).toBe("");
  });
});

// A forwarded invite, same shape as one that arrives from another company's
// mail system: a header block, encoded names, ascii rules, and a markdown
// link whose LABEL is truncated while its target is whole. Values invented.
const FORWARDED_ZOOM = [
  "The following is a new meeting request:",
  "Subject:\tPlatform workshop",
  "Organizer:\tAna Example <ana@example.com>",
  "Time:\tMonday, August 31, 2026, 1:00:00 PM UYT - 4:00:00 PM UYT",
  "Invitees:\tBeto Example <beto@example.com>, Cara Example <cara@example.com>, Mauricio =?utf-8?Q?Am=C3=A9ndola?= <m@example.com>",
  "*~*~*~*~*~*~*~*~*~*",
  "Esta es la invitacion interna para no olvidarnos.",
  "----( Video Call )----",
  "[https://us02web.zoom.us/j/819](https://us02web.zoom.us/j/81906789196)",
  "---===---",
].join("\n");

describe("a forwarded invite", () => {
  const parsed = parseMeetingBody(FORWARDED_ZOOM);

  it("takes the markdown TARGET, not its truncated label", () => {
    // The label reads .../819 and the target .../81906789196. Picking the
    // label produces a join button that goes nowhere.
    expect(parsed.conference?.url).toBe("https://us02web.zoom.us/j/81906789196");
    expect(parsed.conference?.kind).toBe("zoom");
  });

  it("names the organizer", () => {
    expect(parsed.organizer).toBe("Ana Example");
  });

  it("lists the invitees, with encoded names decoded", () => {
    expect(parsed.invitees).toEqual([
      "Beto Example",
      "Cara Example",
      "Mauricio Améndola",
    ]);
  });

  it("keeps the one line a person actually wrote", () => {
    expect(parsed.text).toBe("Esta es la invitacion interna para no olvidarnos.");
  });
});

describe("unrecognisedLink", () => {
  it("is true when there are links but none is a call we know", () => {
    // "No join link found" beats an empty space, which reads as "no call".
    const parsed = parseMeetingBody(
      "Dial in via https://meet.example-corp.internal/room/7",
    );
    expect(parsed.conference).toBeNull();
    expect(parsed.unrecognisedLink).toBe(true);
  });

  it("is false when the meeting simply has no links", () => {
    expect(parseMeetingBody("Out of office").unrecognisedLink).toBe(false);
  });

  it("is false once a call IS recognised", () => {
    expect(
      parseMeetingBody("https://meet.google.com/abc-defg-hij").unrecognisedLink,
    ).toBe(false);
  });
});

describe("parseMeetingBody", () => {
  it("turns the wall into a button, two details and a short line", () => {
    const parsed = parseMeetingBody(TEAMS_INVITE);
    expect(parsed.conference?.kind).toBe("teams");
    expect(parsed.details).toHaveLength(2);
    expect(parsed.text).not.toMatch(/https?:\/\//);
  });

  it("handles a plain meeting with nothing special in it", () => {
    expect(parseMeetingBody("Coffee")).toEqual({
      conference: null,
      details: [],
      organizer: null,
      invitees: [],
      unrecognisedLink: false,
      text: "Coffee",
    });
  });
});
