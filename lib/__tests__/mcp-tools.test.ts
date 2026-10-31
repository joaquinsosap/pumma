// Structural checks over the tool catalogue.
//
// These are cheap and they catch a class of mistake that is otherwise found by
// a connected client behaving oddly: two tools sharing a name (the second
// silently wins), a tool whose annotations disagree with the gate that
// actually governs it, or a write tool that slipped in declaring itself a
// read. The gating is driven entirely by `opClass`, so a wrong one is not a
// cosmetic problem: it is the difference between a delete being refused and a
// delete going through.
import { beforeEach, describe, expect, it } from "vitest";
import { getSettings } from "@/lib/db/memory/settings";
import { insertTask } from "@/lib/db/memory/tasks";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import { annotationsFor, runTool, type McpToolDef } from "@/lib/mcp/registry";
import { SCOPE_FOR } from "@/lib/mcp/policy";
import { MCP_SCOPE } from "@/lib/mcp/config";
import type { McpCaller } from "@/lib/mcp/context";
import { listTasksTool } from "@/lib/mcp/tools/read";
import { moveTask } from "@/lib/mcp/tools/write";
import { getCurrentUserId, resetStore } from "@/lib/store/memory";

type AnyTool = McpToolDef<never>;
const tools = MCP_TOOLS as unknown as AnyTool[];

describe("tool catalogue", () => {
  it("has no duplicate names", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("names tools in the snake_case clients expect", () => {
    for (const t of tools) expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("gives every tool a declared op class", () => {
    // defineTool requires one at the type level; this catches a cast.
    for (const t of tools) {
      expect(["read", "create", "update", "delete"]).toContain(t.opClass);
    }
  });

  it("describes every tool, since the description is how a model chooses", () => {
    for (const t of tools) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(20);
    }
  });

  it("keeps annotations honest about what a tool does", () => {
    for (const t of tools) {
      const a = annotationsFor(t.opClass);
      expect(a.readOnlyHint).toBe(t.opClass === "read");
      expect(a.destructiveHint).toBe(t.opClass === "delete");
      // A client may skip confirming an idempotent call, so a create must
      // never claim to be one: running it twice makes two rows.
      if (t.opClass === "create") expect(a.idempotentHint).toBe(false);
    }
  });

  it("routes each op class to the scope it needs", () => {
    // Write must not imply delete. If these ever collapse into one scope, a
    // user who granted "edit my tasks" has also granted "remove them".
    expect(SCOPE_FOR.read).toBe(MCP_SCOPE.read);
    expect(SCOPE_FOR.create).toBe(MCP_SCOPE.write);
    expect(SCOPE_FOR.update).toBe(MCP_SCOPE.write);
    expect(SCOPE_FOR.delete).toBe(MCP_SCOPE.delete);
    expect(MCP_SCOPE.write).not.toBe(MCP_SCOPE.delete);
  });

  it("classifies the tools whose names promise something specific", () => {
    // A name is a promise to the model. `create_*` that was really an update,
    // or a `delete_*` classified as an update, would be gated by the wrong
    // switch while reading as the right one.
    for (const t of tools) {
      if (t.name.startsWith("create_")) expect(t.opClass).toBe("create");
      if (t.name.startsWith("delete_")) expect(t.opClass).toBe("delete");
      if (t.name.startsWith("list_") || t.name.startsWith("get_")) {
        expect(t.opClass).toBe("read");
      }
    }
  });

  it("still covers every entity for reading", () => {
    const names = tools.map((t) => t.name);
    for (const expected of [
      "get_overview",
      "list_tasks",
      "list_projects",
      "list_goals",
      "list_habits",
      "list_notes",
      "get_agenda",
    ]) {
      expect(names).toContain(expected);
    }
  });
});

describe("what a client that only reads structure gets", () => {
  const userId = getCurrentUserId();

  async function caller(): Promise<McpCaller> {
    const settings = (await getSettings(userId))!;
    return {
      userId,
      clientId: "test-client",
      scopes: new Set([MCP_SCOPE.read, MCP_SCOPE.write]),
      settings: {
        ...settings,
        projectTaskSort: "priority",
        mcp: { ...settings.mcp, enabled: true },
      },
      timeZone: "UTC",
    };
  }

  const seed = (title: string, order: number) =>
    insertTask({
      userId,
      title,
      description: "",
      subtasks: [],
      tagIds: [],
      priority: "med",
      status: "todo",
      due: null,
      projectId: "p",
      goalId: null,
      lifeArea: "personal",
      order,
      createdAt: "2026-10-01",
      completedAt: null,
    });

  const reply = (result: unknown) =>
    (result as { structuredContent: { result: Record<string, unknown> } })
      .structuredContent.result;

  const move = async (input: unknown) =>
    reply(await runTool(moveTask, await caller())(moveTask.inputSchema.parse(input)));

  beforeEach(() => {
    resetStore();
  });

  it("gets a write's note along with its data", async () => {
    const a = await seed("a", 0);
    const b = await seed("b", 1);
    const out = await move({ id: a.id, after: b.id });
    expect(out.ok).toBe(true);
    expect(out.position).toBeTypeOf("number");
    expect(out.message).toContain("sorted by Priority");
  });

  it("gets the reason a write was turned down", async () => {
    const out = await move({ id: "nope", after: null });
    expect(out.ok).toBe(false);
    expect(out.message).toContain("No task with id nope");
  });

  it("gets a read as it is, with no copy of the text", async () => {
    const out = reply(
      await runTool(listTasksTool, await caller())(listTasksTool.inputSchema.parse({})),
    );
    expect(out).toHaveProperty("tasks");
    expect(out).not.toHaveProperty("message");
  });
});
