// The Jira connection: what is stored, what the screen may see, and linking a ticket by its number.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const jira = vi.hoisted(() => ({
  calls: [] as { baseUrl: string; token: string }[],
  answer: { ok: true, data: { name: "Jane Doe" } } as
    | { ok: true; data: { name: string } }
    | { ok: false; why: string; error: string },
}));
const issue = vi.hoisted(() => ({
  calls: [] as { baseUrl: string; token: string; key: string }[],
  answer: null as unknown,
}));
vi.mock("@/lib/jira/client", () => ({
  jiraMyself: async (baseUrl: string, token: string) => {
    jira.calls.push({ baseUrl, token });
    return jira.answer;
  },
  jiraIssue: async (baseUrl: string, token: string, key: string) => {
    issue.calls.push({ baseUrl, token, key });
    return issue.answer;
  },
}));

import {
  clearJiraConnectionAction,
  readTicketAction,
  saveJiraConnectionAction,
  testJiraConnectionAction,
} from "@/lib/actions/jira";
import { updateTaskDetail } from "@/lib/actions/tasks";
import { getSettings } from "@/lib/db/memory/settings";
import { insertTask } from "@/lib/db/memory/tasks";
import { jiraBaseUrl, ticketUrlFromInput } from "@/lib/jira/connection-server";
import { getCurrentUserId, getStore, resetStore } from "@/lib/store/memory";

const userId = getCurrentUserId();
const TOKEN = "NjE2MTYxNjE2MTYxOlRoaXNJc0FUZXN0VG9rZW4";
const row = () => getStore().settings.find((s) => s.userId === userId)!;

describe("saving the Jira connection", () => {
  beforeEach(() => {
    resetStore();
    jira.calls = [];
    jira.answer = { ok: true, data: { name: "Jane Doe" } };
  });

  it("keeps the Jira's root from whatever page was pasted", async () => {
    const res = await saveJiraConnectionAction({
      address: "https://desk.example.com/secure/Dashboard.jspa",
      token: TOKEN,
    });
    expect(res).toMatchObject({
      ok: true,
      data: { address: "https://desk.example.com", tokenLast4: TOKEN.slice(-4) },
    });
    expect(await jiraBaseUrl(userId)).toBe("https://desk.example.com");
  });

  it("stores neither the address nor the token readable", async () => {
    await saveJiraConnectionAction({ address: "https://desk.example.com", token: TOKEN });
    const stored = JSON.stringify(row());
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain("desk.example.com");
    expect(row().jiraTokenLast4).toBe(TOKEN.slice(-4));
  });

  it("never hands the encrypted values, or the token, to the screen", async () => {
    await saveJiraConnectionAction({ address: "https://desk.example.com", token: TOKEN });
    const seen = JSON.stringify(await getSettings(userId));
    expect(seen).not.toContain("jiraTokenEnc");
    expect(seen).not.toContain("jiraBaseUrlEnc");
    expect(seen).not.toContain(TOKEN);
  });

  it("keeps the saved token when the address is corrected within the same Jira", async () => {
    await saveJiraConnectionAction({ address: "https://desk.example.com", token: TOKEN });
    const before = row().jiraTokenEnc;
    const res = await saveJiraConnectionAction({
      address: "https://desk.example.com/jira/secure/Dashboard.jspa",
    });
    expect(res.ok).toBe(true);
    expect(row().jiraTokenEnc).toBe(before);
    expect(await jiraBaseUrl(userId)).toBe("https://desk.example.com/jira");
  });

  it.each([
    ["another host", "https://elsewhere.example.org"],
    ["another port of the same host", "https://desk.example.com:8443"],
  ])("will not carry the saved token over to %s", async (_what, moved) => {
    await saveJiraConnectionAction({ address: "https://desk.example.com", token: TOKEN });
    const before = { ...row() };
    const res = await saveJiraConnectionAction({ address: moved });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain("different address");
    // Nothing moved: the token still goes only where it was saved for.
    expect(row().jiraBaseUrlEnc).toBe(before.jiraBaseUrlEnc);
    expect(row().jiraTokenEnc).toBe(before.jiraTokenEnc);
    await testJiraConnectionAction();
    expect(jira.calls).toEqual([{ baseUrl: "https://desk.example.com", token: TOKEN }]);
  });

  it("takes a new address together with a new token", async () => {
    await saveJiraConnectionAction({ address: "https://desk.example.com", token: TOKEN });
    const other = `${TOKEN}-other`;
    const res = await saveJiraConnectionAction({
      address: "https://elsewhere.example.org",
      token: other,
    });
    expect(res).toMatchObject({ ok: true, data: { address: "https://elsewhere.example.org" } });
    await testJiraConnectionAction();
    expect(jira.calls).toEqual([{ baseUrl: "https://elsewhere.example.org", token: other }]);
  });

  it.each([
    ["an http address", { address: "http://desk.example.com", token: TOKEN }],
    ["an address inside the server's network", { address: "https://localhost", token: TOKEN }],
    ["no token at all", { address: "https://desk.example.com" }],
    ["a sentence where the token goes", { address: "https://desk.example.com", token: "my token is secret" }],
    // Four readable characters of a short token would be a real share of it.
    ["a token too short to be one", { address: "https://desk.example.com", token: "abcd1234efgh" }],
    ["Atlassian's cloud, which signs in another way", { address: "https://acme.atlassian.net/browse/X-1", token: TOKEN }],
  ])("refuses %s and saves nothing", async (_what, input) => {
    const res = await saveJiraConnectionAction(input);
    expect(res.ok).toBe(false);
    expect(row().jiraBaseUrlEnc).toBeNull();
    expect(row().jiraTokenEnc).toBeNull();
  });
});

describe("testing and removing it", () => {
  beforeEach(() => {
    resetStore();
    jira.calls = [];
    jira.answer = { ok: true, data: { name: "Jane Doe" } };
  });

  it("asks the saved Jira with the saved token, and says who answered", async () => {
    await saveJiraConnectionAction({ address: "https://desk.example.com/browse/VST-1", token: TOKEN });
    expect(await testJiraConnectionAction()).toEqual({ ok: true, data: { name: "Jane Doe" } });
    expect(jira.calls).toEqual([{ baseUrl: "https://desk.example.com", token: TOKEN }]);
  });

  it("passes on why Jira did not answer", async () => {
    await saveJiraConnectionAction({ address: "https://desk.example.com", token: TOKEN });
    jira.answer = { ok: false, why: "refused", error: "Jira did not accept that token." };
    expect(await testJiraConnectionAction()).toEqual({
      ok: false,
      error: "Jira did not accept that token.",
    });
  });

  it("calls nothing when no connection is saved", async () => {
    expect((await testJiraConnectionAction()).ok).toBe(false);
    expect(jira.calls).toHaveLength(0);
  });

  it("says so, and calls nothing, when what is saved no longer opens", async () => {
    await saveJiraConnectionAction({ address: "https://desk.example.com", token: TOKEN });
    // What a changed server secret leaves behind: a sealed value nothing can open.
    Object.assign(row(), { jiraTokenEnc: "bm90LWEtc2VhbGVkLXZhbHVl" });

    const tested = await testJiraConnectionAction();
    expect(tested.ok).toBe(false);
    expect(!tested.ok && tested.error).toContain("can no longer be read");
    expect(jira.calls).toHaveLength(0);

    // Blank cannot keep a token that cannot be read; a fresh one is asked for.
    const kept = await saveJiraConnectionAction({ address: "https://desk.example.com" });
    expect(kept.ok).toBe(false);
    expect(!kept.ok && kept.error).toContain("can no longer be read");

    const again = await saveJiraConnectionAction({ address: "https://desk.example.com", token: TOKEN });
    expect(again.ok).toBe(true);
    expect(await testJiraConnectionAction()).toEqual({ ok: true, data: { name: "Jane Doe" } });
  });

  it("forgets both on remove", async () => {
    await saveJiraConnectionAction({ address: "https://desk.example.com", token: TOKEN });
    expect((await clearJiraConnectionAction()).ok).toBe(true);
    expect(row()).toMatchObject({
      jiraBaseUrlEnc: null,
      jiraTokenEnc: null,
      jiraTokenLast4: null,
    });
    expect(await jiraBaseUrl(userId)).toBeNull();
  });
});

describe("linking a ticket by its number", () => {
  beforeEach(() => resetStore());

  const makeTask = () =>
    insertTask({
      userId,
      title: "Ship the alert rules",
      tagIds: [],
      priority: "med",
      status: "todo",
      due: null,
      projectId: null,
      goalId: null,
      lifeArea: "work",
      order: 0,
      createdAt: "2026-11-10",
      completedAt: null,
    });
  const stored = (id: string) => getStore().tasks.find((t) => t._id === id)!;

  it("builds the link on the saved Jira", async () => {
    await saveJiraConnectionAction({ address: "https://desk.example.com/secure/Dashboard.jspa", token: TOKEN });
    const task = await makeTask();
    const res = await updateTaskDetail({ id: task.id, ticketUrl: " vst-1234 " });
    expect(res.ok).toBe(true);
    expect(stored(task.id).ticketUrl).toBe("https://desk.example.com/browse/VST-1234");
  });

  it("says where to save the address when there is none, and links nothing", async () => {
    const task = await makeTask();
    const res = await updateTaskDetail({ id: task.id, ticketUrl: "VST-1234" });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain("Settings, Connections, Jira");
    // A row that never had a link has no field at all, which reads as no link.
    expect(stored(task.id).ticketUrl ?? null).toBeNull();
  });

  it("still takes a full link with no connection, and still refuses what is neither", async () => {
    expect(await ticketUrlFromInput(userId, "https://other.example.org/browse/ABC-9")).toEqual({
      ok: true,
      url: "https://other.example.org/browse/ABC-9",
    });
    expect((await ticketUrlFromInput(userId, "see the ticket")).ok).toBe(false);
    expect(await ticketUrlFromInput(userId, "  ")).toEqual({ ok: true, url: null });
    expect(await ticketUrlFromInput(userId, null)).toEqual({ ok: true, url: null });
  });
});

describe("reading where a linked ticket stands", () => {
  const FACTS = {
    key: "VST-1234",
    title: "Alert rules",
    status: "In Review",
    stage: "doing",
    assignee: "Jane Doe",
    type: "Story",
    priority: "High",
  };
  beforeEach(() => {
    resetStore();
    issue.calls = [];
    issue.answer = { ok: true, data: FACTS };
  });
  const connect = () =>
    saveJiraConnectionAction({ address: "https://desk.example.com", token: TOKEN });

  it("asks the connected Jira with the saved token, and passes on what it said", async () => {
    await connect();
    const res = await readTicketAction({ url: "https://desk.example.com/browse/VST-1234" });
    expect(res).toEqual({ ok: true, data: { state: "ok", facts: FACTS } });
    expect(issue.calls).toEqual([
      { baseUrl: "https://desk.example.com", token: TOKEN, key: "VST-1234" },
    ]);
  });

  it("asks nothing, and says where to connect, with no Jira connected", async () => {
    const res = await readTicketAction({ url: "https://desk.example.com/browse/VST-1234" });
    expect(res).toEqual({ ok: true, data: { state: "no-connection" } });
    expect(issue.calls).toHaveLength(0);
  });

  it.each([
    ["on another host", "https://elsewhere.example.org/browse/VST-1234"],
    ["on a look-alike host", "https://desk.example.com.evil.example.org/browse/VST-1234"],
    ["that is no ticket", "https://desk.example.com/secure/Dashboard.jspa"],
  ])("never sends the token for a link %s", async (_what, url) => {
    await connect();
    const res = await readTicketAction({ url });
    expect(res).toEqual({ ok: true, data: { state: "elsewhere" } });
    expect(issue.calls).toHaveLength(0);
  });

  it("passes on why Jira did not answer", async () => {
    await connect();
    issue.answer = { ok: false, why: "no-ticket", error: "Jira has no ticket with that number." };
    expect(await readTicketAction({ url: "https://desk.example.com/browse/VST-1234" })).toEqual({
      ok: true,
      data: { state: "failed", error: "Jira has no ticket with that number." },
    });
  });

  it("says the connection needs entering again when it no longer opens, and asks nothing", async () => {
    await connect();
    Object.assign(row(), { jiraTokenEnc: "bm90LWEtc2VhbGVkLXZhbHVl" });
    const res = await readTicketAction({ url: "https://desk.example.com/browse/VST-1234" });
    expect(res.ok && res.data?.state).toBe("failed");
    expect(issue.calls).toHaveLength(0);
  });

  it("never hands the token or the address secrets back with the answer", async () => {
    await connect();
    const res = await readTicketAction({ url: "https://desk.example.com/browse/VST-1234" });
    expect(JSON.stringify(res)).not.toContain(TOKEN);
  });
});
