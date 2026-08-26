/**
 * Two-step confirmation for a delete that takes other rows with it.
 *
 * Deleting a project also deletes its tasks. That is the right behaviour and
 * it is what the UI does, but over MCP nobody sees a dialog: a model reads
 * "delete the old website project" and a handful of tasks nobody mentioned go
 * with it. So the first call reports the blast radius and mints a handle, and
 * only a second call carrying that handle actually deletes anything.
 *
 * The handle is not a credential, and the MCP security guidance is explicit
 * that it must never be treated as one. Possession proves nothing here: the
 * caller is already authenticated by their token, the handle is stored against
 * the user id taken from that token, and redeeming one issued to somebody else
 * fails on the owner check rather than on secrecy. It is random anyway, and
 * short-lived, because a guessable or immortal handle would turn a confirmation
 * step into a formality.
 */
import "server-only";
import { randomBytes } from "crypto";

const TTL_MS = 5 * 60 * 1000;
const COLLECTION = "mcpConfirm";

export interface PendingDelete {
  entity: string;
  id: string;
  /** What the user will lose, in the words the tool showed them. */
  summary: string;
}

/** In-process fallback for memory mode, which has no Mongo to write to. */
const memory = new Map<string, { userId: string; at: number } & PendingDelete>();

function newHandle(): string {
  return randomBytes(18).toString("base64url");
}

/**
 * Record an intended delete and return the handle that can perform it.
 *
 * Keyed by user, so a handle is only ever redeemable by the account it was
 * issued to, whatever the caller claims.
 */
export async function stageDelete(
  userId: string,
  pending: PendingDelete,
): Promise<string> {
  const handle = newHandle();
  const at = Date.now();

  if (process.env.DATA_SOURCE !== "mongodb") {
    memory.set(handle, { userId, at, ...pending });
    return handle;
  }
  const { getDb } = await import("@/lib/mongodb");
  const db = await getDb();
  await db.collection(COLLECTION).insertOne({
    handle,
    userId,
    entity: pending.entity,
    entityId: pending.id,
    summary: pending.summary,
    at: new Date(at),
  });
  return handle;
}

/**
 * Redeem a handle, or explain why not.
 *
 * Single use: a redeemed handle is removed, so a retried call cannot delete a
 * second thing that happens to have taken the first one's place.
 */
export async function redeemDelete(
  userId: string,
  handle: string,
  expect: { entity: string; id: string },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const expired = (at: number) => Date.now() - at > TTL_MS;

  if (process.env.DATA_SOURCE !== "mongodb") {
    const row = memory.get(handle);
    memory.delete(handle);
    if (!row) return { ok: false, reason: "unknown or already used" };
    if (row.userId !== userId) return { ok: false, reason: "not yours" };
    if (expired(row.at)) return { ok: false, reason: "expired" };
    if (row.entity !== expect.entity || row.id !== expect.id) {
      return { ok: false, reason: "issued for something else" };
    }
    return { ok: true };
  }

  const { getDb } = await import("@/lib/mongodb");
  const db = await getDb();
  // Deleted as it is read, so two concurrent calls cannot both redeem it.
  const row = await db.collection(COLLECTION).findOneAndDelete({ handle });
  if (!row) return { ok: false, reason: "unknown or already used" };
  // Checked against the token's user, never against anything the caller sent.
  if (String(row.userId) !== userId) return { ok: false, reason: "not yours" };
  const at = row.at instanceof Date ? row.at.getTime() : 0;
  if (expired(at)) return { ok: false, reason: "expired" };
  if (String(row.entity) !== expect.entity || String(row.entityId) !== expect.id) {
    return { ok: false, reason: "issued for something else" };
  }
  return { ok: true };
}

export const CONFIRM_TTL_MINUTES = TTL_MS / 60000;
