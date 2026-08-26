/**
 * What a connected client may do, decided here and nowhere else.
 *
 * The point of this file is that it is not advice. A tool description asking
 * a model not to delete things is a request; this is a refusal. It runs inside
 * the route handler, on every call, against the settings row as it reads right
 * now, so a model that ignores its instructions, a client with a bug, and a
 * stolen token all meet the same answer.
 *
 * Two independent gates, and both must pass:
 *
 *   scope   what you granted THAT client when you connected it. Checked by
 *           requireMcpAuth against the token. Fixed until re-consent.
 *   policy  what you allow ANY client at this moment. Checked here. Changes
 *           the instant you flip a switch in Settings.
 *
 * They fail differently on purpose. A missing scope is recoverable by the
 * client (step up and ask for it), so it returns the RFC 6750 challenge. A
 * policy refusal is not recoverable by the client at all, only by the person
 * in Settings, so it returns a terminal error saying exactly that.
 */
import type { Settings } from "@/lib/schemas";
import { MCP_SCOPE } from "@/lib/mcp/config";

/**
 * What a tool does to the data, declared by the tool rather than inferred.
 *
 * Inferring it from the name ("anything starting with delete_") would work
 * until the first tool that does not follow the pattern, and that tool would
 * be ungated with nothing to notice it.
 */
export type McpOpClass = "read" | "create" | "update" | "delete";

/** The scope a class of operation requires. */
export const SCOPE_FOR: Record<McpOpClass, string> = {
  read: MCP_SCOPE.read,
  create: MCP_SCOPE.write,
  update: MCP_SCOPE.write,
  delete: MCP_SCOPE.delete,
};

/** Refusal that is the user's to reverse, not the client's. */
export class McpPolicyError extends Error {
  constructor(
    message: string,
    readonly opClass: McpOpClass,
  ) {
    super(message);
    this.name = "McpPolicyError";
  }
}

/** Refusal because the token was never granted this much. */
export class McpScopeError extends Error {
  constructor(readonly missing: string[]) {
    super(`Missing required scope: ${missing.join(", ")}`);
    this.name = "McpScopeError";
  }
}

type McpSettings = Settings["mcp"];

/**
 * Whether MCP is on for this account at all.
 *
 * Separate from the per-class checks so the master switch can be reported
 * with its own message: "you have not turned this on" and "you have turned
 * this particular thing off" are different problems with different fixes.
 */
export function mcpEnabledFor(settings: { mcp?: Partial<McpSettings> }): boolean {
  return settings.mcp?.enabled === true;
}

/**
 * Throw unless this account currently allows this class of operation.
 *
 * Reads a settings object the caller fetched for this request. Deliberately
 * not cached across requests: the whole value of the switch is that it takes
 * effect immediately, and a cache would make "I turned it off" mean "I turned
 * it off, mostly, soon".
 */
export function assertMcpAllowed(
  settings: { mcp?: Partial<McpSettings> },
  opClass: McpOpClass,
): void {
  if (!mcpEnabledFor(settings)) {
    throw new McpPolicyError(
      "MCP access is turned off for this account. Turn it on in PUMMA under Settings, Connections.",
      opClass,
    );
  }
  const mcp = settings.mcp ?? {};
  const allowed =
    opClass === "read" ||
    (opClass === "create" && mcp.allowCreate !== false) ||
    (opClass === "update" && mcp.allowUpdate !== false) ||
    (opClass === "delete" && mcp.allowDelete === true);

  if (!allowed) {
    throw new McpPolicyError(
      `${LABEL[opClass]} over MCP is disabled for this account. ` +
        `Only the account owner can change that, in PUMMA under Settings, Connections. ` +
        `Do not retry; ask them to enable it.`,
      opClass,
    );
  }
}

const LABEL: Record<McpOpClass, string> = {
  read: "Reading",
  create: "Creating items",
  update: "Editing items",
  delete: "Deleting items",
};

/**
 * Throw unless the token carries the scope this operation needs.
 *
 * Scopes arrive as the space-delimited string RFC 6749 specifies. An absent
 * claim is treated as no scopes rather than as unrestricted, because the one
 * failure that must never happen here is a token being granted more by
 * accident than it was issued with.
 */
export function assertScope(
  claims: { scope?: unknown },
  opClass: McpOpClass,
): void {
  const required = SCOPE_FOR[opClass];
  const raw = typeof claims.scope === "string" ? claims.scope : "";
  const granted = new Set(raw.split(" ").filter(Boolean));
  if (!granted.has(required)) throw new McpScopeError([required]);
}
