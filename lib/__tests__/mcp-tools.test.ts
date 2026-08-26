// Structural checks over the tool catalogue.
//
// These are cheap and they catch a class of mistake that is otherwise found by
// a connected client behaving oddly: two tools sharing a name (the second
// silently wins), a tool whose annotations disagree with the gate that
// actually governs it, or a write tool that slipped in declaring itself a
// read. The gating is driven entirely by `opClass`, so a wrong one is not a
// cosmetic problem: it is the difference between a delete being refused and a
// delete going through.
import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import { annotationsFor, type McpToolDef } from "@/lib/mcp/registry";
import { SCOPE_FOR } from "@/lib/mcp/policy";
import { MCP_SCOPE } from "@/lib/mcp/config";

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
