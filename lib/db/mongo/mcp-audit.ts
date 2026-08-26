import { getDb } from "@/lib/mongodb";
import type { McpAuditEntry, McpAuditRow } from "@/lib/mcp/audit-types";

const COLLECTION = "mcpAudit";

/**
 * Record one tool call.
 *
 * Deliberately stores no arguments and no result bodies. Those are the user's
 * own content, and this collection is not covered by the per-user encryption
 * specs, so writing them here would quietly create a plaintext copy of data
 * that is encrypted everywhere else. The tool name, the entity ids it touched
 * and the outcome are enough to answer "what did that thing do to my data on
 * Tuesday", which is the question this exists for.
 *
 * Never allowed to fail a request: an audit write that throws would turn a
 * successful tool call into an error, which is a worse outcome than a missing
 * audit line.
 */
export async function recordMcpCall(entry: McpAuditEntry): Promise<void> {
  try {
    const db = await getDb();
    await db.collection(COLLECTION).insertOne({ ...entry });
  } catch {
    /* Logged nowhere on purpose: see above. */
  }
}

export async function listMcpAudit(
  userId: string,
  limit = 20,
): Promise<McpAuditRow[]> {
  const db = await getDb();
  const rows = await db
    .collection(COLLECTION)
    .find({ userId })
    .sort({ at: -1 })
    .limit(limit)
    .toArray();
  return rows.map((r) => ({
    userId: String(r.userId),
    clientId: String(r.clientId ?? ""),
    clientName: r.clientName ? String(r.clientName) : undefined,
    tool: String(r.tool ?? ""),
    opClass: r.opClass as McpAuditRow["opClass"],
    ok: Boolean(r.ok),
    errorCode: r.errorCode ? String(r.errorCode) : undefined,
    entityIds: Array.isArray(r.entityIds) ? r.entityIds.map(String) : undefined,
    tookMs: Number(r.tookMs ?? 0),
    at: String(r.at ?? ""),
  }));
}

/** Used by account deletion, which must leave nothing behind. */
export async function deleteMcpAudit(userId: string): Promise<number> {
  const db = await getDb();
  const res = await db.collection(COLLECTION).deleteMany({ userId });
  return res.deletedCount ?? 0;
}
