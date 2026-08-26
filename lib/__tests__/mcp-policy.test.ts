// The gate that makes "turn off deletes" mean something.
//
// This is the security boundary of the whole MCP feature, and the reason it is
// worth a truth table rather than a couple of happy-path cases: everything
// else in the feature is a convenience, and this is the part that has to hold
// when a model misbehaves, a client has a bug, or a refresh token is stolen.
//
// The two gates are tested separately AND together, because the interesting
// failures are in the seam. A token with delete scope must still be refused
// when the account disallows deletes; an account that allows deletes must
// still refuse a token that was never granted the scope.
import { describe, expect, it } from "vitest";
import {
  assertMcpAllowed,
  assertScope,
  mcpEnabledFor,
  McpPolicyError,
  McpScopeError,
  SCOPE_FOR,
  type McpOpClass,
} from "@/lib/mcp/policy";
import { MCP_SCOPE } from "@/lib/mcp/config";

const settings = (over: Record<string, unknown> = {}) => ({
  mcp: {
    enabled: true,
    allowCreate: true,
    allowUpdate: true,
    allowDelete: false,
    serveExternal: true,
    ...over,
  },
});

const CLASSES: McpOpClass[] = ["read", "create", "update", "delete"];

const allows = (s: { mcp?: Record<string, unknown> }, op: McpOpClass): boolean => {
  try {
    assertMcpAllowed(s, op);
    return true;
  } catch {
    return false;
  }
};

describe("master switch", () => {
  it("is off unless explicitly turned on", () => {
    // The default matters: a settings row written before MCP existed has no
    // `mcp` key at all, and it must not read as consent.
    expect(mcpEnabledFor({})).toBe(false);
    expect(mcpEnabledFor({ mcp: {} })).toBe(false);
    expect(mcpEnabledFor({ mcp: { enabled: false } })).toBe(false);
    expect(mcpEnabledFor({ mcp: { enabled: true } })).toBe(true);
  });

  it("refuses every operation when off, reads included", () => {
    const off = settings({ enabled: false, allowDelete: true });
    for (const op of CLASSES) expect(allows(off, op)).toBe(false);
  });

  it("says which switch to flip", () => {
    try {
      assertMcpAllowed({ mcp: { enabled: false } }, "read");
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(McpPolicyError);
      expect((e as Error).message).toMatch(/Settings/);
    }
  });
});

describe("per-class policy", () => {
  it("allows reads whenever MCP is on", () => {
    expect(allows(settings(), "read")).toBe(true);
  });

  it("gates deletes off by default", () => {
    // The one irreversible action, and the one the user explicitly wanted to
    // be able to forbid outright.
    expect(allows(settings(), "delete")).toBe(false);
    expect(allows(settings({ allowDelete: true }), "delete")).toBe(true);
  });

  it("gates create and update independently", () => {
    expect(allows(settings({ allowCreate: false }), "create")).toBe(false);
    expect(allows(settings({ allowCreate: false }), "update")).toBe(true);
    expect(allows(settings({ allowUpdate: false }), "update")).toBe(false);
    expect(allows(settings({ allowUpdate: false }), "create")).toBe(true);
  });

  it("treats a missing create/update flag as allowed, and a missing delete flag as not", () => {
    // Asymmetric on purpose. An older settings row should keep working for
    // ordinary edits, but must never be read as permission to delete.
    expect(allows({ mcp: { enabled: true } }, "create")).toBe(true);
    expect(allows({ mcp: { enabled: true } }, "update")).toBe(true);
    expect(allows({ mcp: { enabled: true } }, "delete")).toBe(false);
  });

  it("tells the caller not to retry, because only the owner can change it", () => {
    try {
      assertMcpAllowed(settings(), "delete");
      throw new Error("should have refused");
    } catch (e) {
      expect((e as Error).message).toMatch(/Do not retry/);
    }
  });
});

describe("scope", () => {
  it("maps each class to the scope it needs", () => {
    expect(SCOPE_FOR.read).toBe(MCP_SCOPE.read);
    expect(SCOPE_FOR.create).toBe(MCP_SCOPE.write);
    expect(SCOPE_FOR.update).toBe(MCP_SCOPE.write);
    // Delete is its own scope, so granting write does not grant removal.
    expect(SCOPE_FOR.delete).toBe(MCP_SCOPE.delete);
  });

  it("accepts a token carrying the required scope", () => {
    const claims = { scope: `${MCP_SCOPE.read} ${MCP_SCOPE.write}` };
    expect(() => assertScope(claims, "read")).not.toThrow();
    expect(() => assertScope(claims, "create")).not.toThrow();
  });

  it("refuses a token without it, and names what is missing", () => {
    const claims = { scope: `${MCP_SCOPE.read} ${MCP_SCOPE.write}` };
    try {
      assertScope(claims, "delete");
      throw new Error("should have refused");
    } catch (e) {
      expect(e).toBeInstanceOf(McpScopeError);
      expect((e as McpScopeError).missing).toEqual([MCP_SCOPE.delete]);
    }
  });

  it("treats an absent or malformed scope claim as granting nothing", () => {
    // The one failure that must never happen: a missing claim reading as
    // unrestricted rather than as empty.
    for (const claims of [{}, { scope: "" }, { scope: null }, { scope: 42 }]) {
      expect(() => assertScope(claims as { scope?: unknown }, "read")).toThrow(
        McpScopeError,
      );
    }
  });

  it("does not let a scope substring pass for the real thing", () => {
    // "pumma:read" must not satisfy a check for "pumma:read-write" and a
    // prefix must not satisfy the full scope.
    expect(() => assertScope({ scope: "pumma:delete-nothing" }, "delete")).toThrow();
    expect(() => assertScope({ scope: "pumma" }, "read")).toThrow();
  });
});

describe("both gates together", () => {
  it("refuses when the account forbids it even though the token allows it", () => {
    // The stolen-token case: a full-scope token is still bounded by what the
    // account currently permits, and that is the point of having two gates.
    const claims = { scope: `${MCP_SCOPE.read} ${MCP_SCOPE.write} ${MCP_SCOPE.delete}` };
    expect(() => assertScope(claims, "delete")).not.toThrow();
    expect(() => assertMcpAllowed(settings(), "delete")).toThrow(McpPolicyError);
  });

  it("refuses when the account allows it but the token was never granted it", () => {
    const claims = { scope: MCP_SCOPE.read };
    expect(() => assertMcpAllowed(settings({ allowDelete: true }), "delete")).not.toThrow();
    expect(() => assertScope(claims, "delete")).toThrow(McpScopeError);
  });

  it("permits only when both agree", () => {
    const claims = { scope: `${MCP_SCOPE.read} ${MCP_SCOPE.delete}` };
    expect(() => assertScope(claims, "delete")).not.toThrow();
    expect(() => assertMcpAllowed(settings({ allowDelete: true }), "delete")).not.toThrow();
  });
});
