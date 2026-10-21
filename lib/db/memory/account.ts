import { getStore } from "@/lib/store/memory";
import type { MemoryStore } from "@/lib/store/memory";
import { redactForExport } from "@/lib/export-redaction";
import {
  DELETE_ONLY_COLLECTIONS,
  EXPORTED_COLLECTIONS,
} from "@/lib/account-collections";

type Row = { userId?: string };

/** The shared lists, narrowed to what the memory store holds: no billing, auth or MCP tables here. */
const held = (names: readonly string[]) =>
  names.filter((name): name is keyof MemoryStore => {
    const rows = (getStore() as unknown as Record<string, unknown>)[name];
    return Array.isArray(rows) && name !== "users";
  });

export async function exportUserData(
  userId: string,
): Promise<Record<string, unknown[]>> {
  const store = getStore();
  const out: Record<string, unknown[]> = {};
  for (const name of EXPORTED_COLLECTIONS) {
    const rows = (store as unknown as Record<string, Row[] | undefined>)[name] ?? [];
    out[name] = redactForExport(name, rows.filter((row) => row.userId === userId));
  }
  out.profile = redactForExport("users", store.users.filter((u) => u._id === userId));
  return out;
}

export async function deleteAllUserData(
  userId: string,
): Promise<Record<string, number>> {
  const store = getStore();
  const removed: Record<string, number> = {};
  for (const key of held([...DELETE_ONLY_COLLECTIONS, ...EXPORTED_COLLECTIONS])) {
    const rows = store[key] as unknown as Row[];
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
