// What PUMMA shows of a Jira ticket: read out of Jira's answer, and never trusted as it comes.
import { describe, expect, it } from "vitest";
import { jiraFactsFrom, jiraUserIds } from "@/lib/jira/issue";

const answer = (fields: Record<string, unknown>, key: unknown = "VST-1234") => ({
  id: "10042",
  key,
  self: "https://desk.example.com/rest/api/2/issue/10042",
  fields,
});

const FULL = {
  summary: "Alert rules for the ingest queue",
  status: { name: "In Review", statusCategory: { key: "indeterminate", name: "In Progress" } },
  assignee: { name: "jdoe", displayName: "Jane Doe" },
  issuetype: { name: "Story", subtask: false },
  priority: { name: "High" },
};

describe("jiraFactsFrom", () => {
  it("reads where a ticket stands, who has it and what kind it is", () => {
    expect(jiraFactsFrom(answer(FULL))).toEqual({
      key: "VST-1234",
      title: "Alert rules for the ingest queue",
      status: "In Review",
      stage: "doing",
      assignee: "Jane Doe",
      type: "Story",
      priority: "High",
    });
  });

  it.each([
    ["new", "todo"],
    ["indeterminate", "doing"],
    ["done", "done"],
  ])("sorts Jira's %s bucket as %s, whatever the step is called", (bucket, stage) => {
    const facts = jiraFactsFrom(
      answer({ ...FULL, status: { name: "Anything", statusCategory: { key: bucket } } }),
    );
    expect(facts?.stage).toBe(stage);
    expect(facts?.status).toBe("Anything");
  });

  it("keeps the step's name and guesses no bucket when Jira names one it does not know", () => {
    const facts = jiraFactsFrom(
      answer({ ...FULL, status: { name: "Parked", statusCategory: { key: "undefined" } } }),
    );
    expect(facts).toMatchObject({ status: "Parked", stage: null });
  });

  it("says nobody has a ticket with no assignee", () => {
    expect(jiraFactsFrom(answer({ ...FULL, assignee: null }))?.assignee).toBeNull();
  });

  it("falls back to the sign-in name when Jira gives no display name", () => {
    expect(jiraFactsFrom(answer({ ...FULL, assignee: { name: "jdoe" } }))?.assignee).toBe("jdoe");
  });

  it("leaves out what Jira did not send, without failing the rest", () => {
    expect(jiraFactsFrom(answer({ summary: "Only a title" }))).toEqual({
      key: "VST-1234",
      title: "Only a title",
      status: null,
      stage: null,
      assignee: null,
      type: null,
      priority: null,
    });
  });

  it("cuts somebody else's text to one bounded line", () => {
    const facts = jiraFactsFrom(
      answer({
        ...FULL,
        summary: `Line one\n\n  line two ${"x".repeat(1000)}`,
        status: { name: `Wait\ting ${"y".repeat(200)}` },
        assignee: { displayName: "z".repeat(500) },
      }),
    );
    expect(facts?.title?.startsWith("Line one line two")).toBe(true);
    expect(facts?.title?.includes("\n")).toBe(false);
    expect(facts?.title?.length).toBeLessThanOrEqual(300);
    expect(facts?.status?.length).toBeLessThanOrEqual(60);
    expect(facts?.assignee?.length).toBeLessThanOrEqual(80);
  });

  it("takes text only as text", () => {
    const facts = jiraFactsFrom(
      answer({
        summary: { toString: "nope" },
        status: "In Review",
        assignee: ["Jane"],
        issuetype: { name: 7 },
        priority: { name: "  " },
      }),
    );
    expect(facts).toEqual({
      key: "VST-1234",
      title: null,
      status: null,
      stage: null,
      assignee: null,
      type: null,
      priority: null,
    });
  });

  it.each([
    ["nothing", null],
    ["a web page", "<html>Sign in</html>"],
    ["a list", [answer(FULL)]],
    ["an error body", { errorMessages: ["Issue Does Not Exist"], errors: {} }],
    ["an issue with no fields", { key: "VST-1" }],
    ["a key that is not a ticket number", answer(FULL, "../../admin")],
    ["a key that is not text", answer(FULL, 42)],
  ])("is no ticket at all for %s", (_what, raw) => {
    expect(jiraFactsFrom(raw)).toBeNull();
  });
});

describe("jiraUserIds", () => {
  it("gives both names Jira knows a user by, lowercased, each saying which it is", () => {
    expect(jiraUserIds({ name: "J.Doe", key: "JIRAUSER10", displayName: "Jane Doe" })).toEqual([
      "name:j.doe",
      "key:jirauser10",
    ]);
  });

  it("never matches one person's name against another's key", () => {
    // Renamed: her old name stays her key. He was given the freed name later.
    const her = jiraUserIds({ name: "ana.lopez", key: "ana" });
    const him = new Set(jiraUserIds({ name: "ana", key: "JIRAUSER10500" }));
    expect(her.some((id) => him.has(id))).toBe(false);
  });

  it("never takes the display name for one: two people can share it", () => {
    expect(jiraUserIds({ displayName: "Jane Doe" })).toEqual([]);
  });

  it("gives nothing for nobody, a blank, or something that is not a user", () => {
    expect(jiraUserIds(null)).toEqual([]);
    expect(jiraUserIds({ name: "  ", key: 7 })).toEqual([]);
    expect(jiraUserIds(["j.doe"])).toEqual([]);
    expect(jiraUserIds("j.doe")).toEqual([]);
  });
});
