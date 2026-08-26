import { getStore } from "@/lib/store/memory";
import type { McpAuditEntry, McpAuditRow } from "@/lib/mcp/audit-types";

/** Same guard the other memory stores use: getStore() outlives its schema. */
function rows(): McpAuditEntry[] {
  const s = getStore() as { mcpAudit?: McpAuditEntry[] };
  s.mcpAudit ??= [];
  return s.mcpAudit;
}

export async function recordMcpCall(entry: McpAuditEntry): Promise<void> {
  rows().unshift(entry);
  // Memory mode is a demo, not a record. Keep it from growing without bound.
  rows().splice(200);
}

export async function listMcpAudit(
  userId: string,
  limit = 20,
): Promise<McpAuditRow[]> {
  return rows()
    .filter((r) => r.userId === userId)
    .slice(0, limit);
}

export async function deleteMcpAudit(userId: string): Promise<number> {
  const all = rows();
  const before = all.length;
  const kept = all.filter((r) => r.userId !== userId);
  all.length = 0;
  all.push(...kept);
  return before - all.length;
}
