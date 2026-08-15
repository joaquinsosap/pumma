import { getStore } from "@/lib/store/memory";
import type { MemoryStore } from "@/lib/store/memory";
import { NEVER_EXPORT } from "@/lib/export-redaction";

function stripSecrets<T>(rows: T[]): T[] {
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const copy = { ...(row as Record<string, unknown>) };
    for (const field of NEVER_EXPORT) delete copy[field];
    return copy as T;
  });
}

/**
 * Mirrors the mongo collection list. `users` is keyed by `_id` rather than
 * `userId`, so it's handled separately in both backends.
 */
const USER_KEYS = [
  "agenda",
  "goals",
  "habitEntries",
  "habits",
  "lifeDays",
  "lifeWeeks",
  "notes",
  "projects",
  "settings",
  "tags",
  "tasks",
] as const satisfies readonly (keyof MemoryStore)[];

export async function exportUserData(
  userId: string,
): Promise<Record<string, unknown[]>> {
  const store = getStore();
  const out: Record<string, unknown[]> = {};
  for (const key of USER_KEYS) {
    const rows = store[key] as unknown as { userId?: string }[];
    out[key] = stripSecrets(rows.filter((row) => row.userId === userId));
  }
  // No subscriptions collection in memory mode — billing is a hosted concern.
  out.subscriptions = [];
  // Memory mode stores nothing encrypted, but it shares the redaction list so
  // the two backends cannot disagree about what must never be exported.
  out.profile = stripSecrets(store.users.filter((u) => u._id === userId));
  return out;
}

export async function deleteAllUserData(
  userId: string,
): Promise<Record<string, number>> {
  const store = getStore();
  const removed: Record<string, number> = {};
  for (const key of USER_KEYS) {
    const rows = store[key] as unknown as { userId?: string }[];
    const before = rows.length;
    const kept = rows.filter((row) => row.userId !== userId);
    // Replace in place: other modules hold references to these arrays.
    rows.length = 0;
    rows.push(...kept);
    removed[key] = before - rows.length;
  }
  const before = store.users.length;
  const kept = store.users.filter((u) => u._id !== userId);
  store.users.length = 0;
  store.users.push(...kept);
  removed.profile = before - store.users.length;
  return removed;
}
