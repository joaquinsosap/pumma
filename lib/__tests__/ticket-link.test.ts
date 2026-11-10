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

  it("measures the link it will keep, not the one that was pasted", () => {
    // Under the cap as typed, several times over it once the accents are escaped.
    const pasted = `https://jira.example.com/browse/${"\u00e9".repeat(1000)}`;
    expect(pasted.length).toBeLessThan(TICKET_URL_MAX);
    expect(cleanTicketUrl(pasted)).toBeNull();
    const kept = cleanTicketUrl("https://jira.example.com/browse/VST 1")!;
    expect(kept.length).toBeLessThanOrEqual(TICKET_URL_MAX);
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
    ["on a service desk portal", "https://desk.example.com/servicedesk/customer/portal/3/VST-7"],
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

  it("reads a link with a broken escape as a plain link instead of failing", () => {
    for (const url of [
      "https://jira.example.com/browse/%zz",
      "https://jira.example.com/browse/%E0%A4",
    ]) {
      expect(() => ticketFromUrl(url)).not.toThrow();
      expect(ticketFromUrl(url)).toMatchObject({ key: null, kind: "link" });
    }
  });

  it("shows nothing for no link, and nothing for a stored value that is not one", () => {
    expect(ticketFromUrl(null)).toBeNull();
    expect(ticketFromUrl("")).toBeNull();
    // A row written some other way must never reach an href.
    expect(ticketFromUrl("javascript:alert(1)")).toBeNull();
  });
});
