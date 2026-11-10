// A task's ticket link: what is safe to store, and what the chip reads off it.
import { describe, expect, it } from "vitest";
import { TICKET_URL_MAX, cleanTicketUrl, ticketFromUrl } from "@/lib/ticket-link";

describe("cleanTicketUrl", () => {
  it("keeps a plain https link, trimmed", () => {
    expect(cleanTicketUrl("  https://jira.example.com/browse/VST-12  ")).toBe(
      "https://jira.example.com/browse/VST-12",
    );
  });

  it.each([
    ["a script", "javascript:alert(1)"],
    ["a script in capitals with spaces", "  JaVaScRiPt:alert(1)"],
    ["a data page", "data:text/html,<script>alert(1)</script>"],
    ["a file", "file:///etc/passwd"],
    ["a bare key", "VST-12"],
    ["words", "see the ticket"],
    ["nothing", "   "],
    ["a link with a password in it", "https://me:secret@jira.example.com/browse/VST-12"],
  ])("refuses %s", (_what, raw) => {
    expect(cleanTicketUrl(raw)).toBeNull();
  });

  it("refuses what is not text at all", () => {
    expect(cleanTicketUrl(null)).toBeNull();
    expect(cleanTicketUrl(undefined)).toBeNull();
    expect(cleanTicketUrl({ href: "https://x.test" })).toBeNull();
  });

  it("refuses a link longer than any ticket's", () => {
    const long = `https://jira.example.com/browse/VST-1?q=${"a".repeat(TICKET_URL_MAX)}`;
    expect(cleanTicketUrl(long)).toBeNull();
  });
});

describe("ticketFromUrl", () => {
  it("reads the key off a hosted Jira link", () => {
    expect(ticketFromUrl("https://jira.example.com/browse/VST-1234")).toEqual({
      url: "https://jira.example.com/browse/VST-1234",
      key: "VST-1234",
      kind: "jira",
      host: "jira.example.com",
      label: "VST-1234",
    });
  });

  it.each([
    ["behind a context path", "https://tools.example.com/jira/browse/VST-7"],
    ["on Atlassian Cloud", "https://acme.atlassian.net/browse/VST-7"],
    ["with a comment focused", "https://jira.example.com/browse/VST-7?focusedCommentId=9#comment-9"],
    ["from a filter view", "https://jira.example.com/issues/VST-7?filter=-1"],
    ["open on a board", "https://jira.example.com/secure/RapidBoard.jspa?rapidView=4&selectedIssue=VST-7"],
    ["typed in lower case", "https://jira.example.com/browse/vst-7"],
  ])("finds the key %s", (_where, url) => {
    expect(ticketFromUrl(url)?.key).toBe("VST-7");
    expect(ticketFromUrl(url)?.kind).toBe("jira");
  });

  it("shows any other link by where it lives", () => {
    const link = ticketFromUrl("https://www.example.org/tickets/42");
    expect(link).toMatchObject({ key: null, kind: "link", label: "example.org" });
  });

  it("does not mistake a path word for a key", () => {
    expect(ticketFromUrl("https://example.org/browse/shoes")?.key).toBeNull();
    expect(ticketFromUrl("https://example.org/browse")?.key).toBeNull();
  });

  it("shows nothing for no link, and nothing for a stored value that is not one", () => {
    expect(ticketFromUrl(null)).toBeNull();
    expect(ticketFromUrl("")).toBeNull();
    // A row written some other way must never reach an href.
    expect(ticketFromUrl("javascript:alert(1)")).toBeNull();
  });
});
