// Asking Jira where a set of tickets stand: how little is asked, and what is made of the answer.
import { beforeEach, describe, expect, it, vi } from "vitest";

const jira = vi.hoisted(() => ({
  paths: [] as string[],
  /** What to answer a search with, by the order the searches arrive. */
  answers: [] as unknown[],
}));
vi.mock("@/lib/jira/client", () => ({
  jiraGet: async (_base: string, _token: string, path: string) => {
    jira.paths.push(path);
    return jira.answers.shift() ?? { ok: true, data: { issues: [] } };
  },
}));

import { readTicketStatuses } from "@/lib/jira/status-read";

const CONN = { baseUrl: "https://desk.example.com", token: "t0ken-value-that-is-long-enough" };

const issue = (
  key: string,
  name: string,
  bucket: "new" | "indeterminate" | "done",
  resolved: string | null = null,
  assignee: { name: string; key: string } | null = null,
) => ({
  key,
  fields: {
    status: { name, statusCategory: { key: bucket } },
    resolutiondate: resolved,
    assignee,
  },
});
const found = (...issues: unknown[]) => ({ ok: true, data: { issues } });
const jqlOf = (path: string) =>
  decodeURIComponent(/jql=([^&]*)/.exec(path)![1]);

beforeEach(() => {
  jira.paths = [];
  jira.answers = [];
});

describe("reading where tickets stand", () => {
  it("gives each ticket its step, its bucket and the moment Jira closed it", async () => {
    jira.answers = [
      found(
        issue("PROJ-1", "In Review", "indeterminate"),
        issue("PROJ-2", "Closed", "done", "2026-03-01T10:22:33.000+0000"),
      ),
    ];

    const res = await readTicketStatuses(CONN, ["PROJ-1", "PROJ-2"]);

    if (!res.ok) throw new Error("expected an answer");
    expect(res.data.statuses.get("PROJ-1")).toEqual({
      name: "In Review",
      stage: "doing",
      finished: null,
      mine: null,
    });
    expect(res.data.statuses.get("PROJ-2")).toEqual({
      name: "Closed",
      stage: "done",
      finished: "2026-03-01T10:22:33.000Z",
      mine: null,
    });
  });

  it("tells his tickets from everybody else's, and from nobody's", async () => {
    jira.answers = [
      found(
        issue("PROJ-1", "Open", "new", null, { name: "jsosa", key: "JIRAUSER1" }),
        issue("PROJ-2", "Open", "new", null, { name: "ana", key: "JIRAUSER2" }),
        issue("PROJ-3", "Open", "new"),
      ),
    ];

    const res = await readTicketStatuses(CONN, ["PROJ-1", "PROJ-2", "PROJ-3"], new Set(["name:jsosa", "key:jirauser1"]));

    if (!res.ok) throw new Error("expected an answer");
    expect(res.data.statuses.get("PROJ-1")?.mine).toBe(true);
    expect(res.data.statuses.get("PROJ-2")?.mine).toBe(false);
    expect(res.data.statuses.get("PROJ-3")?.mine).toBe(false);
  });

  it("says nothing of whose a ticket is when Jira left the field out", async () => {
    const bare = { key: "PROJ-1", fields: { status: { name: "Open", statusCategory: { key: "new" } } } };
    jira.answers = [found(bare)];

    const res = await readTicketStatuses(CONN, ["PROJ-1"], new Set(["name:jsosa"]));

    expect(res.ok && res.data.statuses.get("PROJ-1")?.mine).toBeNull();
  });

  it("asks once for up to fifty tickets, for the status, the closing date and who has it, and nothing else", async () => {
    const keys = Array.from({ length: 50 }, (_, i) => `PROJ-${i + 1}`);

    await readTicketStatuses(CONN, keys);

    expect(jira.paths).toHaveLength(1);
    expect(jira.paths[0]).toContain("fields=status,resolutiondate,assignee&");
    expect(jira.paths[0]).toContain("maxResults=50");
    expect(jira.paths[0]).toContain("validateQuery=false");
    expect(jqlOf(jira.paths[0])).toBe(`key in (${keys.join(", ")})`);
  });

  it("asks once per fifty, and about each ticket once however often it is named", async () => {
    const keys = Array.from({ length: 60 }, (_, i) => `PROJ-${i + 1}`);

    await readTicketStatuses(CONN, [...keys, "PROJ-1", "proj-2"]);

    expect(jira.paths).toHaveLength(2);
    expect(jqlOf(jira.paths[1]).split(", ")).toHaveLength(10);
  });

  it("stops at four searches and says there was more", async () => {
    const keys = Array.from({ length: 230 }, (_, i) => `PROJ-${i + 1}`);

    const res = await readTicketStatuses(CONN, keys);

    expect(jira.paths).toHaveLength(4);
    expect(res.ok && res.data.capped).toBe(true);
  });

  it("puts nothing into the search that is not a ticket number", async () => {
    await readTicketStatuses(CONN, ["PROJ-1", 'PROJ-2) OR project = "X"', "nope"]);

    expect(jqlOf(jira.paths[0])).toBe("key in (PROJ-1)");
  });

  it("asks nothing when no ticket number is left", async () => {
    const res = await readTicketStatuses(CONN, ["nope"]);

    expect(jira.paths).toEqual([]);
    expect(res.ok && res.data.statuses.size).toBe(0);
  });

  it("skips a ticket whose answer names no step", async () => {
    jira.answers = [found({ key: "PROJ-1", fields: {} }, issue("PROJ-2", "Open", "new"))];

    const res = await readTicketStatuses(CONN, ["PROJ-1", "PROJ-2"]);

    expect(res.ok && [...res.data.statuses.keys()]).toEqual(["PROJ-2"]);
  });
});

describe("when Jira does not answer as hoped", () => {
  const error = { ok: false, why: "error", error: "Jira answered with an error. (400)" };
  const refused = { ok: false, why: "refused", error: "Jira did not accept that token." };

  it("stops at once when the token is refused", async () => {
    jira.answers = [refused];
    const keys = Array.from({ length: 60 }, (_, i) => `PROJ-${i + 1}`);

    const res = await readTicketStatuses(CONN, keys);

    expect(res).toEqual(refused);
    expect(jira.paths).toHaveLength(1);
  });

  it("stops asking at the first search Jira refuses, and keeps what was answered", async () => {
    jira.answers = [found(issue("PROJ-1", "Open", "new")), error];
    const keys = Array.from({ length: 130 }, (_, i) => `PROJ-${i + 1}`);

    const res = await readTicketStatuses(CONN, keys);

    expect(jira.paths).toHaveLength(2);
    if (!res.ok) throw new Error("expected an answer");
    expect([...res.data.statuses.keys()]).toEqual(["PROJ-1"]);
    expect(res.data.capped).toBe(true);
  });

  it("fails when the first search errors, without asking again", async () => {
    jira.answers = [error];
    const keys = Array.from({ length: 60 }, (_, i) => `PROJ-${i + 1}`);

    expect(await readTicketStatuses(CONN, keys)).toEqual(error);
    expect(jira.paths).toHaveLength(1);
  });

  it("fails on an answer that is not a search result", async () => {
    jira.answers = [{ ok: true, data: { hello: "world" } }];

    const res = await readTicketStatuses(CONN, ["PROJ-1"]);

    expect(res).toMatchObject({ ok: false, why: "not-jira" });
  });
});
