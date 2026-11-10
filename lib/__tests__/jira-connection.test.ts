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
vi.mock("@/lib/jira/client", () => ({
  jiraMyself: async (baseUrl: string, token: string) => {
    jira.calls.push({ baseUrl, token });
    return jira.answer;
  },
}));

import {
  clearJiraConnectionAction,
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

  it("keeps the saved token when only the address is corrected", async () => {
    await saveJiraConnectionAction({ address: "https://old.example.com", token: TOKEN });
    const before = row().jiraTokenEnc;
    const res = await saveJiraConnectionAction({ address: "https://desk.example.com" });
    expect(res.ok).toBe(true);
    expect(row().jiraTokenEnc).toBe(before);
    expect(await jiraBaseUrl(userId)).toBe("https://desk.example.com");
  });

  it.each([
    ["an http address", { address: "http://desk.example.com", token: TOKEN }],
    ["an address inside the server's network", { address: "https://localhost", token: TOKEN }],
    ["no token at all", { address: "https://desk.example.com" }],
    ["a sentence where the token goes", { address: "https://desk.example.com", token: "my token is secret" }],
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
