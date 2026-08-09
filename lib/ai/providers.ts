// The list of AI providers a user can pick from, and everything that differs
// between them. Pure data — no SDK imports — so the settings UI can import it.
//
// Deliberately a closed list: endpoints come from here, never from user input,
// so the server can only ever call hosts this file names.

export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "openrouter"
  | "groq"
  | "deepseek"
  | "mistral"
  | "xai"
  | "ollama";

/**
 * How reliably a provider can be held to a JSON schema.
 *
 * Below "strict" the model can return valid JSON that doesn't match the schema,
 * so the call is validated and retried once — see lib/ai/generate.ts.
 */
export type StructuredMode = "native" | "strict" | "schema" | "json";

export type ProviderDef = {
  id: ProviderId;
  label: string;
  /** Which client builds the model handle. */
  sdk: "anthropic" | "openai" | "google" | "openai-compatible";
  /** Pinned endpoint for the OpenAI-compatible hosts. Native SDKs know theirs. */
  baseUrl?: string;
  defaultModel: string;
  /** Suggestions for the model dropdown; "Custom…" always sits alongside. */
  models: string[];
  /** Loose sanity check on a pasted key — catches typos, not much else. */
  keyPattern: RegExp;
  keyHint: string;
  /** Where to go and get one. */
  docsUrl?: string;
  /** Local servers generally accept anything, including nothing. */
  keyOptional?: boolean;
  structured: StructuredMode;
  /** Anthropic's cache_control on the static system block. */
  promptCache?: boolean;
  note?: string;
  group: "vendor" | "gateway" | "local";
};

/** Anything printable, 8+ chars — the generic "looks like a key" check. */
const GENERIC_KEY = /^[\x21-\x7e]{8,200}$/;

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    sdk: "anthropic",
    defaultModel: "claude-haiku-4-5",
    models: ["claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-1"],
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{16,200}$/,
    keyHint: "sk-ant-…",
    docsUrl: "https://console.anthropic.com/settings/keys",
    structured: "native",
    promptCache: true,
    group: "vendor",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    sdk: "openai",
    defaultModel: "gpt-4.1-mini",
    models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o", "gpt-4o-mini", "o4-mini"],
    keyPattern: /^sk-[A-Za-z0-9_-]{16,200}$/,
    keyHint: "sk-…",
    docsUrl: "https://platform.openai.com/api-keys",
    structured: "strict",
    group: "vendor",
  },
  google: {
    id: "google",
    label: "Google Gemini",
    sdk: "google",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    keyPattern: /^[A-Za-z0-9_-]{20,120}$/,
    keyHint: "AIza…",
    docsUrl: "https://aistudio.google.com/apikey",
    structured: "native",
    group: "vendor",
  },

  // Everything below speaks the OpenAI wire format. One code path, one row each.
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    sdk: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-haiku-4.5",
    models: [
      "anthropic/claude-haiku-4.5",
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-4.1-mini",
      "google/gemini-2.5-flash",
      "deepseek/deepseek-chat",
    ],
    keyPattern: /^sk-or-[A-Za-z0-9_-]{16,200}$/,
    keyHint: "sk-or-…",
    docsUrl: "https://openrouter.ai/keys",
    structured: "schema",
    note: "One key, most models. The easiest option if you don't already pay a provider.",
    group: "gateway",
  },
  groq: {
    id: "groq",
    label: "Groq",
    sdk: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    keyPattern: /^gsk_[A-Za-z0-9_-]{16,200}$/,
    keyHint: "gsk_…",
    docsUrl: "https://console.groq.com/keys",
    structured: "schema",
    note: "Very fast, open models.",
    group: "gateway",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    sdk: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    keyPattern: GENERIC_KEY,
    keyHint: "sk-…",
    docsUrl: "https://platform.deepseek.com/api_keys",
    structured: "schema",
    group: "gateway",
  },
  mistral: {
    id: "mistral",
    label: "Mistral",
    sdk: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    models: ["mistral-small-latest", "mistral-large-latest"],
    keyPattern: GENERIC_KEY,
    keyHint: "your Mistral key",
    docsUrl: "https://console.mistral.ai/api-keys",
    structured: "schema",
    group: "gateway",
  },
  xai: {
    id: "xai",
    label: "xAI Grok",
    sdk: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-3-mini",
    models: ["grok-3-mini", "grok-3"],
    keyPattern: /^xai-[A-Za-z0-9_-]{16,200}$/,
    keyHint: "xai-…",
    docsUrl: "https://console.x.ai",
    structured: "schema",
    group: "gateway",
  },
  ollama: {
    id: "ollama",
    label: "Ollama (local)",
    sdk: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.1",
    models: ["llama3.1", "qwen2.5", "mistral"],
    keyPattern: GENERIC_KEY,
    keyHint: "not needed",
    keyOptional: true,
    structured: "json",
    note: "Runs on your own machine. Small models often fail the planner's schema.",
    group: "local",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as [
  ProviderId,
  ...ProviderId[],
];

export const DEFAULT_PROVIDER: ProviderId = "anthropic";

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && value in PROVIDERS;
}

export function providerDef(id: ProviderId | null | undefined): ProviderDef {
  return PROVIDERS[id && isProviderId(id) ? id : DEFAULT_PROVIDER];
}

/**
 * Which model a call uses.
 *
 * The user's pick wins; ASSISTANT_MODEL lets a self-hoster set one for the whole
 * instance; the provider's default is the floor so a call is never made without
 * a model.
 */
export function resolveModel(
  provider: ProviderId,
  userModel: string | null | undefined,
  envModel?: string | null,
): string {
  const chosen = userModel?.trim() || envModel?.trim();
  return chosen || PROVIDERS[provider].defaultModel;
}

/** Ollama's address is the operator's to change, never a user's. */
export function providerBaseUrl(
  provider: ProviderId,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (provider === "ollama") {
    return env.OLLAMA_BASE_URL || PROVIDERS.ollama.baseUrl;
  }
  return PROVIDERS[provider].baseUrl;
}

/** Whether a pasted key is plausible for this provider. */
export function isPlausibleKey(provider: ProviderId, key: string): boolean {
  const def = PROVIDERS[provider];
  const trimmed = key.trim();
  if (!trimmed) return Boolean(def.keyOptional);
  return def.keyPattern.test(trimmed);
}
