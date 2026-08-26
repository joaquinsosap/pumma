/**
 * How a tool gets defined, and why it cannot forget to be gated.
 *
 * Every tool is declared through `defineTool`, which requires an `opClass`.
 * The gating then happens in one wrapper here rather than in each handler, so
 * "did this tool remember to check the delete setting" is not a question that
 * can have a wrong answer per tool. A new tool is gated because it exists,
 * not because someone remembered.
 *
 * The wrapper also owns the audit line and the error shaping, for the same
 * reason: those are things every tool must do identically, and identical code
 * repeated twenty times drifts.
 */
import "server-only";
import * as z from "zod/v4";
import type { McpCaller } from "@/lib/mcp/context";
import {
  assertMcpAllowed,
  assertScope,
  McpPolicyError,
  McpScopeError,
  type McpOpClass,
} from "@/lib/mcp/policy";
import { recordMcpCall } from "@/lib/db/mcp-audit";
import { toolInput } from "@/lib/mcp/schema";

/** What a handler returns: text for the model, plus ids for the audit line. */
export interface ToolOutcome {
  /** Rendered for the model. Keep it terse and factual. */
  text: string;
  /** Machine-readable mirror, for clients that prefer structure. */
  data?: unknown;
  /** Ids this call touched, recorded in the audit trail. */
  entityIds?: string[];
}

export interface McpToolDef<S extends z.ZodType> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  opClass: McpOpClass;
  /**
   * Whether a client should treat this as destructive. Mirrors opClass rather
   * than being set by hand, so the annotation cannot disagree with the gate.
   */
  handler: (input: z.infer<S>, caller: McpCaller) => Promise<ToolOutcome>;
}

/**
 * Declare a tool. The only way to make one.
 *
 * Generic in the schema so `input` reaches the handler fully typed, which is
 * what stops the handler from re-validating or reaching for `any`.
 */
export function defineTool<S extends z.ZodType>(def: McpToolDef<S>): McpToolDef<S> {
  // Every tool's schema picks up the JSON Schema converter here rather than at
  // each definition, so a new tool cannot be written without it and then fail
  // only when a client asks for tools/list.
  toolInput(def.inputSchema);
  return def;
}

/** MCP annotations, derived from the op class so they cannot drift from it. */
export function annotationsFor(opClass: McpOpClass) {
  return {
    readOnlyHint: opClass === "read",
    destructiveHint: opClass === "delete",
    // Reads and deletes repeat harmlessly; a second create makes a second row.
    idempotentHint: opClass === "read" || opClass === "delete",
    openWorldHint: false,
  };
}

/**
 * A tool result in the shape the MCP SDK expects.
 *
 * `isError: true` is a tool-level failure, which is what a policy refusal is:
 * the request was well-formed and understood, and the answer is no. It is
 * deliberately not a protocol error, because the client did nothing wrong and
 * the model should read the reason and relay it.
 */
function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function okResult(outcome: ToolOutcome) {
  return {
    content: [{ type: "text" as const, text: outcome.text }],
    ...(outcome.data === undefined ? {} : { structuredContent: { result: outcome.data } }),
  };
}

/**
 * Wrap a handler with the checks every tool must pass.
 *
 * Order is scope, then policy. Scope is what the client was granted and can
 * fix by asking for more; policy is what the account allows and only the
 * account owner can change. Checking scope first means a client missing a
 * grant gets told to ask for it, rather than being told the feature is
 * disabled when actually it just never requested access to it.
 */
export function runTool<S extends z.ZodType>(
  def: McpToolDef<S>,
  caller: McpCaller,
  clientName?: string,
) {
  return async (input: z.infer<S>) => {
    const started = Date.now();
    let entityIds: string[] | undefined;
    let ok = false;
    let errorCode: string | undefined;

    try {
      assertScope({ scope: [...caller.scopes].join(" ") }, def.opClass);
      assertMcpAllowed(caller.settings, def.opClass);

      const outcome = await def.handler(input, caller);
      entityIds = outcome.entityIds;
      ok = true;
      return okResult(outcome);
    } catch (err) {
      if (err instanceof McpScopeError) {
        errorCode = "insufficient_scope";
        return errorResult(
          `This connection was not granted permission to do that (missing ${err.missing.join(", ")}). ` +
            `Reconnect PUMMA and approve the missing permission.`,
        );
      }
      if (err instanceof McpPolicyError) {
        errorCode = "policy_denied";
        return errorResult(err.message);
      }
      errorCode = "error";
      // The message may quote user content, which is fine going back to the
      // caller who owns it, but a stack trace is not something to hand out.
      const message = err instanceof Error ? err.message : "Unknown error";
      return errorResult(`That did not work: ${message}`);
    } finally {
      await recordMcpCall({
        userId: caller.userId,
        clientId: caller.clientId,
        clientName,
        tool: def.name,
        opClass: def.opClass,
        ok,
        errorCode,
        entityIds,
        tookMs: Date.now() - started,
        at: new Date().toISOString(),
      });
    }
  };
}
