import { getStore, newId } from "@/lib/store/memory";
import { settingsToDto, type Settings, settingsSchema } from "@/lib/schemas";
import type { SettingsDoc } from "@/lib/schemas";

export async function getSettings(userId: string): Promise<Settings | null> {
  const store = getStore();
  const doc = store.settings.find((s) => s.userId === userId);
  return doc ? settingsToDto(settingsSchema.parse(doc)) : null;
}

/** Created once at signup (auth bootstrap). Idempotent per user. */
export async function insertSettings(
  doc: Omit<SettingsDoc, "_id"> & { _id?: string },
): Promise<Settings> {
  const store = getStore();
  const existing = store.settings.find((s) => s.userId === doc.userId);
  if (existing) return settingsToDto(settingsSchema.parse(existing));
  const full = { ...doc, _id: doc._id ?? newId() } as SettingsDoc;
  store.settings.push(full);
  return settingsToDto(settingsSchema.parse(full));
}

export async function updateSettings(
  userId: string,
  patch: Partial<SettingsDoc>,
): Promise<Settings | null> {
  const store = getStore();
  const idx = store.settings.findIndex((s) => s.userId === userId);
  if (idx < 0) return null;
  store.settings[idx] = { ...store.settings[idx], ...patch };
  return settingsToDto(settingsSchema.parse(store.settings[idx]));
}

/** Server-only: the raw encrypted API key blob, or null. */
export async function getAiApiKeyEnc(userId: string): Promise<string | null> {
  const store = getStore();
  const doc = store.settings.find((s) => s.userId === userId);
  return doc?.aiApiKeyEnc ?? null;
}
