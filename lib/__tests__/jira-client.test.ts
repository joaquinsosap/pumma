// The Jira client: where the owner's token is allowed to go, and how each kind of failure reads.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const guard = vi.hoisted(() => ({
  where: "public" as "public" | "private" | "nowhere",
  /** A name server that never answers. */
  hangs: false,
}));
vi.mock("@/lib/outbound-guard", () => ({
  whereHostResolves: () =>
    guard.hangs ? new Promise(() => {}) : Promise.resolve(guard.where),
}));

import { jiraGet, jiraIssue, jiraMyself } from "@/lib/jira/client";

const BASE = "https://desk.example.com";
const TOKEN = "t0ken-value-1234";

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const answer = (status: number, body = "", headers: Record<string, string> = {}) =>
  new Response(status === 204 || (status >= 300 && status < 400) ? null : body, {
    status,
    headers,
  });
const stub = (res: Response | Error) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      if (res instanceof Error) throw res;
      return res;
    }),
  );
};

describe("jiraGet", () => {
  beforeEach(() => {
    calls = [];
    guard.where = "public";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks the saved Jira, with the token as a bearer and no redirects followed", async () => {
    stub(answer(200, JSON.stringify({ ok: 1 })));
    const res = await jiraGet(BASE, TOKEN, "/rest/api/2/myself");
    expect(res).toEqual({ ok: true, data: { ok: 1 } });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://desk.example.com/rest/api/2/myself");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].init.redirect).toBe("manual");
  });

  it.each([
    ["an http address", "http://desk.example.com"],
    ["this machine", "https://localhost"],
    ["a private address", "https://192.168.1.10"],
    ["nothing", ""],
  ])("never sends the token to %s", async (_what, base) => {
    stub(answer(200, "{}"));
    const res = await jiraGet(base, TOKEN, "/rest/api/2/myself");
    expect(res.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("never sends the token to a name that resolves inside the server's network", async () => {
    guard.where = "private";
    stub(answer(200, "{}"));
    const res = await jiraGet(BASE, TOKEN, "/rest/api/2/myself");
    expect(res).toMatchObject({ ok: false, why: "address" });
    expect(calls).toHaveLength(0);
  });

  it("says it could not reach a name that leads nowhere, and sends nothing", async () => {
    guard.where = "nowhere";
    stub(answer(200, "{}"));
    const res = await jiraGet(BASE, TOKEN, "/rest/api/2/myself");
    expect(res).toMatchObject({ ok: false, why: "unreachable" });
    expect(calls).toHaveLength(0);
  });

  it("gives up on a name that never resolves, and sends nothing", async () => {
    guard.hangs = true;
    vi.useFakeTimers();
    try {
      stub(answer(200, "{}"));
      const asked = jiraGet(BASE, TOKEN, "/rest/api/2/myself");
      await vi.advanceTimersByTimeAsync(4_100);
      expect(await asked).toMatchObject({ ok: false, why: "unreachable" });
      expect(calls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      guard.hangs = false;
    }
  });

  it("sends nothing without a token", async () => {
    stub(answer(200, "{}"));
    expect((await jiraGet(BASE, "", "/rest/api/2/myself")).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it.each([
    [302, "sign-in"],
    [401, "refused"],
    [403, "forbidden"],
    [404, "not-jira"],
    [500, "error"],
  ])("reads a %i as %s", async (status, why) => {
    stub(answer(status as number, "nope", { location: "https://elsewhere.example.org/login" }));
    const res = await jiraGet(BASE, TOKEN, "/rest/api/2/myself");
    expect(res).toMatchObject({ ok: false, why });
    // One request: a redirect is reported, not followed.
    expect(calls).toHaveLength(1);
  });

  it("says the server could not reach it when the connection fails", async () => {
    stub(new Error("ECONNREFUSED"));
    expect(await jiraGet(BASE, TOKEN, "/rest/api/2/myself")).toMatchObject({
      ok: false,
      why: "unreachable",
    });
  });

  it("does not take a web page for a Jira", async () => {
    stub(answer(200, "<html>Welcome</html>"));
    expect(await jiraGet(BASE, TOKEN, "/rest/api/2/myself")).toMatchObject({
      ok: false,
      why: "not-jira",
    });
  });

  it("refuses an answer too large to be an API reply", async () => {
    stub(answer(200, "{}", { "content-length": String(50 * 1024 * 1024) }));
    expect((await jiraGet(BASE, TOKEN, "/rest/api/2/myself")).ok).toBe(false);
  });

  it("stops reading an answer that arrives in pieces and never ends", async () => {
    // No length stated up front, so the only guard is counting as it arrives.
    const piece = new Uint8Array(256 * 1024).fill(0x20);
    let sent = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(piece);
      },
      cancel() {
        cancelled = true;
      },
    });
    stub(new Response(body, { status: 200 }));
    const res = await jiraGet(BASE, TOKEN, "/rest/api/2/myself");
    expect(res).toMatchObject({ ok: false, why: "error" });
    expect(cancelled).toBe(true);
    // A little past the ceiling of 2 MB, not the whole of an endless body.
    expect(sent).toBeLessThan(20);
  });

  it("reads an answer that arrives in pieces", async () => {
    const text = JSON.stringify({ name: "jdoe" });
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 5));
        controller.enqueue(bytes.slice(5));
        controller.close();
      },
    });
    stub(new Response(body, { status: 200 }));
    expect(await jiraGet(BASE, TOKEN, "/rest/api/2/myself")).toEqual({
      ok: true,
      data: { name: "jdoe" },
    });
  });

  it("never puts the token in what it reports", async () => {
    for (const res of [answer(401), answer(500, "boom"), new Error(`failed with ${TOKEN}`)]) {
      stub(res);
      const out = await jiraGet(BASE, TOKEN, "/rest/api/2/myself");
      expect(JSON.stringify(out)).not.toContain(TOKEN);
    }
  });
});

describe("jiraMyself", () => {
  beforeEach(() => {
    calls = [];
    guard.where = "public";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("gives back who the token belongs to", async () => {
    stub(answer(200, JSON.stringify({ name: "jdoe", displayName: "Jane Doe" })));
    expect(await jiraMyself(BASE, TOKEN)).toEqual({ ok: true, data: { name: "Jane Doe" } });
  });

  it("falls back to the sign-in name, and trims what Jira sends to one short line", async () => {
    stub(answer(200, JSON.stringify({ name: "jdoe" })));
    expect(await jiraMyself(BASE, TOKEN)).toMatchObject({ data: { name: "jdoe" } });
    stub(answer(200, JSON.stringify({ displayName: `Jane\n\n${"x".repeat(500)}` })));
    const long = await jiraMyself(BASE, TOKEN);
    expect(long.ok && long.data.name.length).toBeLessThanOrEqual(80);
    expect(long.ok && long.data.name.includes("\n")).toBe(false);
  });

  it("is not connected when Jira names nobody", async () => {
    stub(answer(200, JSON.stringify({})));
    expect((await jiraMyself(BASE, TOKEN)).ok).toBe(false);
  });
});

describe("jiraIssue", () => {
  beforeEach(() => {
    calls = [];
    guard.where = "public";
  });
  afterEach(() => vi.unstubAllGlobals());

  const ISSUE = {
    key: "VST-1234",
    fields: {
      summary: "Alert rules",
      status: { name: "In Review", statusCategory: { key: "indeterminate" } },
      assignee: { displayName: "Jane Doe" },
      issuetype: { name: "Story" },
      priority: { name: "High" },
    },
  };

  it("asks for that one ticket, and only the fields it shows", async () => {
    stub(answer(200, JSON.stringify(ISSUE)));
    const res = await jiraIssue(BASE, TOKEN, "vst-1234");
    expect(res).toMatchObject({
      ok: true,
      data: { key: "VST-1234", status: "In Review", stage: "doing", assignee: "Jane Doe" },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://desk.example.com/rest/api/2/issue/VST-1234?fields=summary,status,assignee,issuetype,priority",
    );
  });

  it.each([
    ["a path", "../myself"],
    ["a number with a path after it", "VST-1/../../myself"],
    ["a query", "VST-1?expand=changelog"],
    ["a sentence", "VST-1 and more"],
    ["nothing", ""],
  ])("sends nothing when the number is %s", async (_what, key) => {
    stub(answer(200, JSON.stringify(ISSUE)));
    expect((await jiraIssue(BASE, TOKEN, key)).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("says the ticket is missing, not the Jira, on a 404", async () => {
    stub(answer(404, JSON.stringify({ errorMessages: ["Issue Does Not Exist"] })));
    const res = await jiraIssue(BASE, TOKEN, "VST-9");
    expect(res).toMatchObject({ ok: false, why: "no-ticket" });
    expect(!res.ok && res.error).toContain("no ticket with that number");
  });

  it("does not take an answer that is not a ticket for one", async () => {
    stub(answer(200, JSON.stringify({ hello: "world" })));
    expect(await jiraIssue(BASE, TOKEN, "VST-9")).toMatchObject({ ok: false, why: "not-jira" });
  });
});
