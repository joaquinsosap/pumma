// Finding a Jira's root from whatever link was pasted, and refusing the ones a token must never be sent to.
import { describe, expect, it } from "vitest";
import { jiraBaseFromUrl, jiraIssueUrl, jiraKeyOn } from "@/lib/jira/address";
import { ticketKeyFrom } from "@/lib/ticket-link";

describe("jiraBaseFromUrl", () => {
  it.each([
    ["the dashboard", "https://desk.example.com/secure/Dashboard.jspa"],
    ["a ticket", "https://desk.example.com/browse/VST-1234"],
    ["a board", "https://desk.example.com/secure/RapidBoard.jspa?rapidView=4"],
    ["a service desk portal", "https://desk.example.com/servicedesk/customer/portal/3"],
    ["the root with a slash", "https://desk.example.com/"],
    ["the root with no scheme", "desk.example.com"],
    ["an API address", "https://desk.example.com/rest/api/2/myself"],
  ])("finds the root from %s", (_what, pasted) => {
    expect(jiraBaseFromUrl(pasted)).toBe("https://desk.example.com");
  });

  it("keeps the folder a Jira is installed under", () => {
    expect(jiraBaseFromUrl("https://tools.example.com/jira/browse/VST-1")).toBe(
      "https://tools.example.com/jira",
    );
    expect(jiraBaseFromUrl("https://tools.example.com/jira/")).toBe(
      "https://tools.example.com/jira",
    );
  });

  it.each([
    ["plain http, which would send the token in the clear", "http://desk.example.com/browse/VST-1"],
    ["a link with a password in it", "https://me:pw@desk.example.com/"],
    ["this machine", "https://localhost:8080/secure/Dashboard.jspa"],
    ["a private address", "https://10.0.0.5/secure/Dashboard.jspa"],
    ["a name that only exists inside a network", "https://jira.internal/browse/VST-1"],
    ["this machine written as one number", "https://2130706433/browse/VST-1"],
    ["this machine written in hex", "https://0x7f.0.0.1/browse/VST-1"],
    ["a private address written in octal", "https://0300.0250.1.10/browse/VST-1"],
    ["this machine over IPv6", "https://[::1]/browse/VST-1"],
    ["a private address wrapped in IPv6", "https://[::ffff:10.0.0.5]/browse/VST-1"],
    ["the cloud's own metadata address", "https://169.254.169.254/latest/meta-data"],
    ["this machine with a public name after a backslash", "https://localhost\\@desk.example.com/browse/VST-1"],
    ["a script", "javascript:alert(1)"],
    ["nothing", "  "],
  ])("refuses %s", (_what, pasted) => {
    expect(jiraBaseFromUrl(pasted)).toBeNull();
  });

  it("reads a backslash the way the request will: the host before it, never the one after", () => {
    const base = jiraBaseFromUrl("https://desk.example.com\\@localhost/browse/VST-1");
    expect(base && new URL(base).hostname).toBe("desk.example.com");
  });

  it("refuses what is not text", () => {
    expect(jiraBaseFromUrl(null)).toBeNull();
    expect(jiraBaseFromUrl(42)).toBeNull();
  });
});

describe("jiraIssueUrl", () => {
  it("builds a ticket's page", () => {
    expect(jiraIssueUrl("https://desk.example.com", "VST-1234")).toBe(
      "https://desk.example.com/browse/VST-1234",
    );
    expect(jiraIssueUrl("https://tools.example.com/jira/", "VST-1")).toBe(
      "https://tools.example.com/jira/browse/VST-1",
    );
  });
});

describe("jiraKeyOn", () => {
  const BASE = "https://desk.example.com";

  it.each([
    ["its page", "https://desk.example.com/browse/VST-1234"],
    ["a filter view", "https://desk.example.com/issues/VST-1234?filter=-1"],
    ["a board with it open", "https://desk.example.com/secure/RapidBoard.jspa?rapidView=4&selectedIssue=VST-1234"],
    ["a service desk portal", "https://desk.example.com/servicedesk/customer/portal/3/VST-1234"],
  ])("finds the ticket from %s on the connected Jira", (_what, link) => {
    expect(jiraKeyOn(BASE, link)).toBe("VST-1234");
  });

  it("follows a Jira installed under a folder", () => {
    const under = "https://tools.example.com/jira";
    expect(jiraKeyOn(under, "https://tools.example.com/jira/browse/VST-1")).toBe("VST-1");
    // Another Jira on the same host is another Jira.
    expect(jiraKeyOn(under, "https://tools.example.com/browse/VST-1")).toBeNull();
    expect(jiraKeyOn(under, "https://tools.example.com/other/browse/VST-1")).toBeNull();
    // A folder whose name only starts the same is another Jira too.
    expect(jiraKeyOn(under, "https://tools.example.com/jira2/browse/VST-1")).toBeNull();
  });

  it("knows the same Jira written another way", () => {
    expect(jiraKeyOn(BASE, "https://DESK.Example.com/browse/VST-1")).toBe("VST-1");
    expect(jiraKeyOn(BASE, "https://desk.example.com:443/browse/VST-1")).toBe("VST-1");
  });

  it.each([
    ["another host", "https://elsewhere.example.org/browse/VST-1234"],
    ["a look-alike host", "https://desk.example.com.evil.example.org/browse/VST-1234"],
    ["another port", "https://desk.example.com:8443/browse/VST-1234"],
    ["plain http", "http://desk.example.com/browse/VST-1234"],
    ["a page with no ticket in it", "https://desk.example.com/secure/Dashboard.jspa"],
    ["a bare number", "VST-1234"],
    ["nothing", null],
  ])("asks nothing about %s", (_what, link) => {
    expect(jiraKeyOn(BASE, link)).toBeNull();
  });
});

describe("ticketKeyFrom", () => {
  it("reads a ticket number typed on its own", () => {
    expect(ticketKeyFrom("VST-1234")).toBe("VST-1234");
    expect(ticketKeyFrom("  vst-12 ")).toBe("VST-12");
  });

  it("is not fooled by a link, a sentence or a bare word", () => {
    expect(ticketKeyFrom("https://desk.example.com/browse/VST-1")).toBeNull();
    expect(ticketKeyFrom("see VST-1")).toBeNull();
    expect(ticketKeyFrom("VST")).toBeNull();
    expect(ticketKeyFrom("-12")).toBeNull();
    expect(ticketKeyFrom(null)).toBeNull();
  });
});
