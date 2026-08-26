import type { McpOpClass } from "@/lib/mcp/policy";

/**
 * One line in the account's MCP activity log.
 *
 * The fields are chosen for what a suspicious person needs at 2am: which tool,
 * on whose behalf, which client, did it work, and what did it touch. Not the
 * arguments, and not the results, because those are the user's content and
 * this collection has no encryption spec.
 */
export interface McpAuditEntry {
  userId: string;
  /** OAuth client id, so one misbehaving connection can be picked out. */
  clientId: string;
  /** Human name at the time of the call, for a readable settings list. */
  clientName?: string;
  tool: string;
  opClass: McpOpClass;
  ok: boolean;
  /** Why it was refused: a policy refusal reads differently from a crash. */
  errorCode?: string;
  /** Ids only, never titles. */
  entityIds?: string[];
  tookMs: number;
  /** ISO string, consistent with every other timestamp in the app. */
  at: string;
}

export type McpAuditRow = McpAuditEntry;
