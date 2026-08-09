// Resolves which provider, key and model to use for a given user. Real
// (mongodb) accounts MUST bring their own key (stored encrypted in settings) —
// the operator never pays for hosted users' tokens. The shared env key is used
// ONLY in memory mode (local dev / single-user self-host demo).
import "server-only";
import { getAiApiKeyEnc, getSettings } from "@/lib/db/settings";
import { decryptSecret } from "@/lib/crypto";
import {
  DEFAULT_PROVIDER,
  isProviderId,
  providerBaseUrl,
  providerDef,
  resolveModel,
  type ProviderId,
} from "@/lib/ai/providers";

export const NO_API_KEY_MESSAGE =
  "Add an AI provider key in Settings → Assistant to use Plan and Ask.";

export type AiCredentials = {
  provider: ProviderId;
  /** Empty only where the provider says a key is optional (local servers). */
  apiKey: string;
  model: string;
  baseUrl?: string;
};

/**
 * Everything a call needs, or null when the user has no usable key.
 *
 * Provider and model come from settings; the endpoint comes from the registry,
 * never from stored data — so no settings row, however it got there, can point
 * the server at a host this repo doesn't name.
 */
export async function resolveAiCredentials(
  userId: string,
): Promise<AiCredentials | null> {
  const settings = await getSettings(userId);
  const provider: ProviderId = isProviderId(settings?.aiProvider)
    ? settings.aiProvider
    : (envProvider() ?? DEFAULT_PROVIDER);
  const def = providerDef(provider);

  const model = resolveModel(
    provider,
    settings?.aiModel ?? null,
    process.env.ASSISTANT_MODEL,
  );
  const baseUrl = providerBaseUrl(provider);

  const enc = await getAiApiKeyEnc(userId);
  if (enc) {
    // A key that won't decrypt (secret rotated / tampered) counts as "not set".
    const decrypted = decryptSecret(enc);
    if (decrypted) return { provider, apiKey: decrypted, model, baseUrl };
  }

  // No per-user key. The shared env key is a local-dev/demo convenience only —
  // never let real accounts spend the operator's tokens.
  if (process.env.DATA_SOURCE !== "mongodb") {
    const shared = sharedEnvKey(provider);
    if (shared) return { provider, apiKey: shared, model, baseUrl };
  }

  // A local server authenticates nothing, so "no key" is still usable there.
  if (def.keyOptional) return { provider, apiKey: "", model, baseUrl };

  return null;
}

/** Whether an AI call for this user would have a usable key (no secret exposed). */
export async function hasResolvableAiKey(userId: string): Promise<boolean> {
  return (await resolveAiCredentials(userId)) !== null;
}

/** Instance-wide default, for a self-hoster who doesn't want to click through Settings. */
function envProvider(): ProviderId | null {
  const raw = process.env.AI_PROVIDER;
  return isProviderId(raw) ? raw : null;
}

function sharedEnvKey(provider: ProviderId): string | undefined {
  // AI_API_KEY is the provider-agnostic name; the vendor-specific ones are kept
  // because they're what people already have in their .env.
  const generic = process.env.AI_API_KEY;
  if (generic) return generic;
  switch (provider) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "google":
      return process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    default:
      return undefined;
  }
}
