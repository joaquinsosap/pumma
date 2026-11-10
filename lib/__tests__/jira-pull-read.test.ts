// Reading a pull from Jira: what is asked, how little, and how the answers are hung.
import { beforeEach, describe, expect, it, vi } from "vitest";

// A pretend Jira: a handful of tickets, and just enough JQL to answer the
// searches the reader writes. Anything else it is asked is a test failure.
type Fake = {
  key: string;
  type: string;
  title?: string;
  bucket?: "new" | "indeterminate" | "done";
  epic?: string;
  parent?: string;
  mine?: boolean;
};

const jira = vi.hoisted(() => ({
  tickets: [] as Fake[],
  calls: [] as string[],
  fields: [] as unknown,
  /** How the parent link is written in an answer: the number itself, or wrapped. */
  parentShape: "string" as "string" | "object" | "data",
  failOn: null as string | null,
}));

const EPIC = "customfield_10101";
const PARENT = "customfield_13101";

const STD_FIELDS = [
  { id: "summary", name: "Summary", custom: false },
  { id: "customfield_10001", name: "Sprint", custom: true, schema: { custom: "com.pyxis.greenhopper.jira:gh-sprint" } },
  { id: EPIC, name: "Epic Link", custom: true, schema: { custom: "com.pyxis.greenhopper.jira:gh-epic-link" } },
  { id: PARENT, name: "Parent Link", custom: true, schema: { custom: "com.atlassian.jpo:jpo-custom-field-parent" } },
];

function issueJson(t: Fake) {
  const parent =
    t.parent === undefined
      ? null
      : jira.parentShape === "string"
        ? t.parent
        : jira.parentShape === "object"
          ? { key: t.parent, id: 1 }
          : { showField: true, data: { key: t.parent, summary: "x" } };
  return {
    key: t.key,
    fields: {
      summary: t.title ?? `Title of ${t.key}`,
      status: { name: "Some step", statusCategory: { key: t.bucket ?? "new" } },
      issuetype: { name: t.type },
      [EPIC]: t.epic ?? null,
      [PARENT]: parent,
    },
  };
}

function runJql(jql: string): Fake[] {
  const body = jql.replace(/ ORDER BY key ASC$/, "");
  const list = (text: string) => text.split(",").map((k) => k.trim());
  let m: RegExpExecArray | null;
  if ((m = /^key in \((.+)\)$/.exec(body))) {
    const keys = list(m[1]);
    return jira.tickets.filter((t) => keys.includes(t.key));
  }
  if ((m = /^cf\[10101\] = (\S+)$/.exec(body))) return jira.tickets.filter((t) => t.epic === m![1]);
  if ((m = /^cf\[10101\] in \((.+)\)$/.exec(body))) {
    const keys = list(m[1]);
    return jira.tickets.filter((t) => t.epic && keys.includes(t.epic));
  }
  if ((m = /^cf\[13101\] = (\S+)$/.exec(body))) return jira.tickets.filter((t) => t.parent === m![1]);
  if (body === "assignee = currentUser() AND resolution = Unresolved") {
    return jira.tickets.filter((t) => t.mine);
  }
  throw new Error(`the pretend Jira was asked something it does not know: ${jql}`);
}

vi.mock("@/lib/jira/client", () => ({
  jiraGet: async (_base: string, _token: string, path: string) => {
    jira.calls.push(path);
    if (jira.failOn && path.includes(jira.failOn)) {
      return { ok: false, why: "refused", error: "Jira did not accept that token." };
    }
    const url = new URL(`https://x${path}`);
    if (url.pathname === "/rest/api/2/field") return { ok: true, data: jira.fields };
    if (url.pathname === "/rest/api/2/search") {
      const all = runJql(url.searchParams.get("jql") ?? "").sort((a, b) => a.key.localeCompare(b.key));
      const startAt = Number(url.searchParams.get("startAt"));
      const max = Number(url.searchParams.get("maxResults"));
      return {
        ok: true,
        data: { startAt, maxResults: max, total: all.length, issues: all.slice(startAt, startAt + max).map(issueJson) },
      };
    }
    const one = /^\/rest\/api\/2\/issue\/([^/]+)$/.exec(url.pathname);
    if (one) {
      const found = jira.tickets.find((t) => t.key === decodeURIComponent(one[1]));
      return found
        ? { ok: true, data: issueJson(found) }
        : { ok: false, why: "no-ticket", error: "Jira has no ticket with that number, or your token cannot see it." };
    }
    throw new Error(`unexpected path ${path}`);
  },
}));

import { forgetLinkFields, keyIn, linkFieldsFrom, readPull } from "@/lib/jira/pull-read";

const CONN = { baseUrl: "https://desk.example.com", token: "t0ken-value-that-is-long-enough" };
const searches = () => jira.calls.filter((c) => c.startsWith("/rest/api/2/search"));
const keys = (list: { key: string }[]) => list.map((t) => t.key);

const COORD_TREE: Fake[] = [
  { key: "COOR-12", type: "Coordination Feature", title: "Platform alerts", bucket: "indeterminate" },
  { key: "VST-210", type: "Epic", title: "Queue alerts", parent: "COOR-12" },
  { key: "VST-214", type: "Epic", title: "Dashboards", parent: "COOR-12" },
  { key: "VST-221", type: "Story", title: "Alert rules", epic: "VST-210", bucket: "indeterminate", mine: true },
  { key: "VST-222", type: "Task", title: "Runbook", epic: "VST-210" },
  { key: "VST-230", type: "Bug", title: "Latency board", epic: "VST-214", bucket: "done" },
  // Somebody else's corner of the same Jira.
  { key: "COOR-99", type: "Coordination Feature", title: "Unrelated" },
  { key: "VST-900", type: "Epic", title: "Unrelated epic", parent: "COOR-99" },
  { key: "VST-901", type: "Story", title: "Unrelated story", epic: "VST-900" },
];

beforeEach(() => {
  jira.tickets = COORD_TREE.map((t) => ({ ...t }));
  jira.calls = [];
  jira.fields = STD_FIELDS;
  jira.parentShape = "string";
  jira.failOn = null;
  forgetLinkFields();
});

describe("readPull, a COORD by its number", () => {
  it("hangs its epics under it and their stories under them, and nothing from elsewhere", async () => {
    const res = await readPull(CONN, { kind: "ticket", key: "coor-12", children: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { forest, capped } = res.data;
    expect(capped).toBe(false);
    expect(keys(forest.coords.map((c) => c.ticket))).toEqual(["COOR-12"]);
    expect(forest.coords[0].ticket).toEqual({
      key: "COOR-12",
      title: "Platform alerts",
      stage: "doing",
      url: "https://desk.example.com/browse/COOR-12",
    });
    expect(forest.coords[0].epics.map((e) => [e.ticket.key, keys(e.stories)])).toEqual([
      ["VST-210", ["VST-221", "VST-222"]],
      ["VST-214", ["VST-230"]],
    ]);
    expect(forest.epics).toEqual([]);
    expect(forest.loose).toEqual([]);
  });

  it("does it in four requests: the fields, the ticket, its epics, their stories", async () => {
    await readPull(CONN, { kind: "ticket", key: "COOR-12", children: true });
    expect(jira.calls).toHaveLength(4);
    expect(jira.calls[0]).toBe("/rest/api/2/field");
    expect(jira.calls[1]).toContain("/rest/api/2/issue/COOR-12?fields=");
    expect(searches()).toHaveLength(2);
  });

  it("asks only for the fields it reads", async () => {
    await readPull(CONN, { kind: "ticket", key: "COOR-12", children: true });
    for (const call of jira.calls.slice(1)) {
      expect(call).toContain(`fields=summary,status,issuetype,${EPIC},${PARENT}`);
    }
  });

  it("brings the COORD alone when its children are not wanted", async () => {
    const res = await readPull(CONN, { kind: "ticket", key: "COOR-12", children: false });
    expect(res.ok && res.data.forest).toEqual({
      coords: [{ ticket: expect.objectContaining({ key: "COOR-12" }), epics: [] }],
      epics: [],
      loose: [],
    });
  });

  it("takes a ticket nothing hangs under, of no working kind, for a COORD with no epics yet", async () => {
    const res = await readPull(CONN, { kind: "ticket", key: "COOR-99", children: false });
    jira.tickets = jira.tickets.filter((t) => t.parent !== "COOR-99");
    const empty = await readPull(CONN, { kind: "ticket", key: "COOR-99", children: true });
    expect(res.ok && keys(res.data.forest.coords.map((c) => c.ticket))).toEqual(["COOR-99"]);
    expect(empty.ok && empty.data.forest).toEqual({
      coords: [{ ticket: expect.objectContaining({ key: "COOR-99" }), epics: [] }],
      epics: [],
      loose: [],
    });
  });

  it.each(["object", "data"] as const)(
    "reads the parent link whether Jira writes it bare or wrapped (%s)",
    async (shape) => {
      jira.parentShape = shape;
      const res = await readPull(CONN, { kind: "mine" });
      expect(res.ok && keys(res.data.forest.coords.map((c) => c.ticket))).toEqual(["COOR-12"]);
    },
  );
});

describe("readPull, an epic by its number", () => {
  it("brings its stories, and the COORD above it so either level can be the project", async () => {
    const res = await readPull(CONN, { kind: "ticket", key: "VST-210", children: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { forest } = res.data;
    expect(keys(forest.coords.map((c) => c.ticket))).toEqual(["COOR-12"]);
    // Only the epic that was asked for: its sibling under the same COORD stays in Jira.
    expect(forest.coords[0].epics.map((e) => [e.ticket.key, keys(e.stories)])).toEqual([
      ["VST-210", ["VST-221", "VST-222"]],
    ]);
  });

  it("stands on its own when nothing is above it", async () => {
    jira.tickets = [
      { key: "VST-5", type: "Epic", title: "Lone epic" },
      { key: "VST-6", type: "Story", epic: "VST-5" },
    ];
    const res = await readPull(CONN, { kind: "ticket", key: "VST-5", children: true });
    expect(res.ok && res.data.forest.coords).toEqual([]);
    expect(res.ok && res.data.forest.epics.map((e) => [e.ticket.key, keys(e.stories)])).toEqual([
      ["VST-5", ["VST-6"]],
    ]);
  });

  it("comes with no stories when its children are not wanted", async () => {
    const res = await readPull(CONN, { kind: "ticket", key: "VST-210", children: false });
    expect(res.ok && res.data.forest.coords[0].epics[0].stories).toEqual([]);
  });
});

describe("readPull, one piece of work by its number", () => {
  it("hangs a story under its epic and COORD, alone", async () => {
    const res = await readPull(CONN, { kind: "ticket", key: "VST-222", children: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.forest.coords[0].epics.map((e) => [e.ticket.key, keys(e.stories)])).toEqual([
      ["VST-210", ["VST-222"]],
    ]);
  });

  it("leaves a story with no epic loose", async () => {
    jira.tickets = [{ key: "OPS-88", type: "Task", title: "Renew the certificate" }];
    const res = await readPull(CONN, { kind: "ticket", key: "OPS-88", children: true });
    expect(res.ok && res.data.forest).toEqual({
      coords: [],
      epics: [],
      loose: [expect.objectContaining({ key: "OPS-88", title: "Renew the certificate" })],
    });
  });
});

describe("readPull, tickets assigned to the token's owner", () => {
  it("hangs each where it belongs, reading only the parents it names", async () => {
    jira.tickets.push({ key: "OPS-88", type: "Task", title: "Loose chore", mine: true });
    const res = await readPull(CONN, { kind: "mine" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { forest } = res.data;
    expect(forest.coords[0].epics.map((e) => [e.ticket.key, keys(e.stories)])).toEqual([
      ["VST-210", ["VST-221"]],
    ]);
    expect(keys(forest.loose)).toEqual(["OPS-88"]);
    // The fields, the assigned tickets, their epics, those epics' COORDs.
    expect(jira.calls).toHaveLength(4);
  });

  it("takes an epic assigned to you as an epic, not as a piece of work", async () => {
    jira.tickets.find((t) => t.key === "VST-214")!.mine = true;
    const res = await readPull(CONN, { kind: "mine" });
    expect(res.ok && res.data.forest.coords[0].epics.map((e) => e.ticket.key).sort()).toEqual([
      "VST-210",
      "VST-214",
    ]);
  });

  it("asks nothing more when nothing is assigned", async () => {
    jira.tickets.forEach((t) => (t.mine = false));
    const res = await readPull(CONN, { kind: "mine" });
    expect(res.ok && res.data.forest).toEqual({ coords: [], epics: [], loose: [] });
    expect(jira.calls).toHaveLength(2);
  });
});

describe("readPull, going easy on Jira", () => {
  it("asks for the list of fields once, not on every pull", async () => {
    await readPull(CONN, { kind: "ticket", key: "COOR-12", children: true });
    await readPull(CONN, { kind: "mine" });
    expect(jira.calls.filter((c) => c === "/rest/api/2/field")).toHaveLength(1);
  });

  it("reads a long list in pages and stops at a ceiling, saying so", async () => {
    jira.tickets = [{ key: "VST-5", type: "Epic", title: "Huge" }];
    for (let i = 0; i < 420; i++) {
      jira.tickets.push({ key: `VST-${1000 + i}`, type: "Story", epic: "VST-5" });
    }
    const res = await readPull(CONN, { kind: "ticket", key: "VST-5", children: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.capped).toBe(true);
    expect(res.data.forest.epics[0].stories).toHaveLength(300);
    expect(searches()).toHaveLength(6);
  });

  it("reads exactly as many pages as there are", async () => {
    jira.tickets = [{ key: "VST-5", type: "Epic", title: "Middling" }];
    for (let i = 0; i < 120; i++) {
      jira.tickets.push({ key: `VST-${1000 + i}`, type: "Story", epic: "VST-5" });
    }
    const res = await readPull(CONN, { kind: "ticket", key: "VST-5", children: true });
    expect(res.ok && res.data.capped).toBe(false);
    expect(res.ok && res.data.forest.epics[0].stories).toHaveLength(120);
    expect(searches()).toHaveLength(3);
  });
});

describe("readPull, when it cannot", () => {
  it.each(["../../myself", "VST-1 OR key != x", "", "VST"])(
    "asks Jira nothing about %j, which is no ticket number",
    async (key) => {
      const res = await readPull(CONN, { kind: "ticket", key, children: true });
      expect(res.ok).toBe(false);
      // Only the list of fields, which names no ticket.
      expect(jira.calls.filter((c) => c !== "/rest/api/2/field")).toEqual([]);
    },
  );

  it("passes on why Jira did not answer, at whichever step", async () => {
    for (const step of ["/rest/api/2/field", "/rest/api/2/issue/", "/rest/api/2/search"]) {
      forgetLinkFields();
      jira.failOn = step;
      const res = await readPull(CONN, { kind: "ticket", key: "COOR-12", children: true });
      expect(res).toEqual({ ok: false, why: "refused", error: "Jira did not accept that token." });
    }
  });

  it("says the ticket is missing when the number names none", async () => {
    const res = await readPull(CONN, { kind: "ticket", key: "VST-404", children: true });
    expect(res).toMatchObject({ ok: false, why: "no-ticket" });
  });

  it("still brings an epic's stories on a Jira with no parent link field", async () => {
    jira.fields = STD_FIELDS.filter((f) => f.id !== PARENT);
    const res = await readPull(CONN, { kind: "ticket", key: "VST-210", children: true });
    expect(res.ok && res.data.forest.coords).toEqual([]);
    expect(res.ok && res.data.forest.epics.map((e) => [e.ticket.key, keys(e.stories)])).toEqual([
      ["VST-210", ["VST-221", "VST-222"]],
    ]);
  });

  it("is not fooled by an answer that is not a list of fields", async () => {
    jira.fields = { message: "Sign in" };
    const res = await readPull(CONN, { kind: "mine" });
    expect(res).toMatchObject({ ok: false, why: "not-jira" });
  });
});

describe("linkFieldsFrom", () => {
  it("finds both fields by what they are, whatever they were renamed to", () => {
    expect(
      linkFieldsFrom([
        { id: "customfield_7", name: "Epica", schema: { custom: "com.pyxis.greenhopper.jira:gh-epic-link" } },
        { id: "customfield_8", name: "Padre", schema: { custom: "com.atlassian.jpo:jpo-custom-field-parent" } },
      ]),
    ).toEqual({ epicLink: "customfield_7", parentLink: "customfield_8" });
  });

  it("falls back to the usual names", () => {
    expect(
      linkFieldsFrom([
        { id: "customfield_1", name: "epic link" },
        { id: "customfield_2", name: " Parent Link " },
      ]),
    ).toEqual({ epicLink: "customfield_1", parentLink: "customfield_2" });
  });

  it("takes nothing for an id that is not a custom field's, since it goes into a search", () => {
    expect(
      linkFieldsFrom([
        { id: "summary) OR (1=1", name: "Epic Link" },
        { id: "customfield_12x", name: "Parent Link" },
      ]),
    ).toEqual({ epicLink: null, parentLink: null });
    expect(linkFieldsFrom("nope")).toEqual({ epicLink: null, parentLink: null });
  });
});

describe("keyIn", () => {
  it("reads a ticket number bare or wrapped, and nothing else", () => {
    expect(keyIn("vst-12")).toBe("VST-12");
    expect(keyIn({ key: "VST-12" })).toBe("VST-12");
    expect(keyIn({ data: { key: "VST-12" } })).toBe("VST-12");
    expect(keyIn({ value: "VST-12" })).toBe("VST-12");
    expect(keyIn("not a key")).toBeNull();
    expect(keyIn({ key: "x) OR (1=1" })).toBeNull();
    expect(keyIn(null)).toBeNull();
    expect(keyIn(12)).toBeNull();
  });
});
