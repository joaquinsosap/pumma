import { getDb } from "@/lib/mongodb";
import { newId } from "@/lib/store/memory";
import { settingsToDto, type Settings, settingsSchema } from "@/lib/schemas";
import type { SettingsDoc } from "@/lib/schemas";

async function col() {
  const db = await getDb();
  return db.collection<SettingsDoc>("settings");
}

export async function getSettings(userId: string): Promise<Settings | null> {
  const c = await col();
  const doc = await c.findOne({ userId });
  return doc ? settingsToDto(settingsSchema.parse(doc)) : null;
}

/** Created once at signup (auth bootstrap). Idempotent per user. */
export async function insertSettings(
  doc: Omit<SettingsDoc, "_id"> & { _id?: string },
): Promise<Settings> {
  const c = await col();
  await c.updateOne(
    { userId: doc.userId },
    { $setOnInsert: { ...doc, _id: doc._id ?? newId() } },
    { upsert: true },
  );
  const saved = await c.findOne({ userId: doc.userId });
  return settingsToDto(settingsSchema.parse(saved));
}

export async function updateSettings(
  userId: string,
  patch: Partial<SettingsDoc>,
): Promise<Settings | null> {
  const c = await col();
  const doc = await c.findOneAndUpdate(
    { userId },
    { $set: patch },
    { returnDocument: "after" },
  );
  return doc ? settingsToDto(settingsSchema.parse(doc)) : null;
}

/** Server-only: the raw encrypted API key blob, or null. Never send to a client. */
export async function getAiApiKeyEnc(userId: string): Promise<string | null> {
  const c = await col();
  const doc = await c.findOne({ userId }, { projection: { aiApiKeyEnc: 1 } });
  return doc?.aiApiKeyEnc ?? null;
}

/** Server-only: the Jira connection as stored, still encrypted. Never send to a client. */
export async function getJiraSecretsEnc(
  userId: string,
): Promise<{ baseUrlEnc: string | null; tokenEnc: string | null }> {
  const c = await col();
  const doc = await c.findOne(
    { userId },
    { projection: { jiraBaseUrlEnc: 1, jiraTokenEnc: 1 } },
  );
  return {
    baseUrlEnc: doc?.jiraBaseUrlEnc ?? null,
    tokenEnc: doc?.jiraTokenEnc ?? null,
  };
}

/** Server-only: the Jira status map as stored, still encrypted. */
export async function getJiraStatusMapEnc(userId: string): Promise<string | null> {
  const c = await col();
  const doc = await c.findOne({ userId }, { projection: { jiraStatusMapEnc: 1 } });
  return doc?.jiraStatusMapEnc ?? null;
}
