import { describe, it, expect } from "vitest";
import {
  PROVIDERS,
  PROVIDER_IDS,
  DEFAULT_PROVIDER,
  isProviderId,
  providerDef,
  resolveModel,
  providerBaseUrl,
  isPlausibleKey,
} from "@/lib/ai/providers";

describe("the provider registry", () => {
  it("gives every entry somewhere to send a request", () => {
    // A native SDK knows its own endpoint; everything else must pin one, or the
    // call would go nowhere at runtime.
    for (const def of Object.values(PROVIDERS)) {
      if (def.sdk === "openai-compatible") {
        expect(def.baseUrl, def.id).toBeTruthy();
      }
    }
  });

  it("only ever points at hosts named here", () => {
    for (const def of Object.values(PROVIDERS)) {
      if (!def.baseUrl) continue;
      const url = new URL(def.baseUrl);
      // Ollama is the one local entry; everything else must be https.
      expect(
        url.protocol === "https:" || url.hostname === "localhost",
        `${def.id} → ${def.baseUrl}`,
      ).toBe(true);
    }
  });

  it("keeps its ids and keys in step", () => {
    for (const id of PROVIDER_IDS) expect(PROVIDERS[id].id).toBe(id);
    expect(isProviderId(DEFAULT_PROVIDER)).toBe(true);
  });

  it("offers its default model in the dropdown list", () => {
    for (const def of Object.values(PROVIDERS)) {
      expect(def.models, def.id).toContain(def.defaultModel);
    }
  });
});

describe("isProviderId", () => {
  it("accepts what's in the registry and nothing else", () => {
    expect(isProviderId("openai")).toBe(true);
    expect(isProviderId("openai-compatible")).toBe(false);
    expect(isProviderId(undefined)).toBe(false);
    // A settings row written by an older build, or by hand.
    expect(isProviderId("")).toBe(false);
  });

  it("falls back rather than throwing on junk", () => {
    expect(providerDef("nonsense" as never).id).toBe(DEFAULT_PROVIDER);
    expect(providerDef(null).id).toBe(DEFAULT_PROVIDER);
  });
});

describe("resolveModel", () => {
  it("prefers the user's pick", () => {
    expect(resolveModel("openai", "gpt-4o", "env-model")).toBe("gpt-4o");
  });

  it("falls back to the instance default, then the provider's", () => {
    expect(resolveModel("openai", null, "env-model")).toBe("env-model");
    expect(resolveModel("openai", null, undefined)).toBe(
      PROVIDERS.openai.defaultModel,
    );
  });

  it("treats whitespace as unset", () => {
    expect(resolveModel("openai", "   ", null)).toBe(
      PROVIDERS.openai.defaultModel,
    );
  });
});

describe("providerBaseUrl", () => {
  it("lets the operator move Ollama, and nobody move the rest", () => {
    expect(
      providerBaseUrl("ollama", { OLLAMA_BASE_URL: "http://box:11434/v1" }),
    ).toBe("http://box:11434/v1");
    expect(providerBaseUrl("ollama", {})).toBe(PROVIDERS.ollama.baseUrl);
    expect(
      providerBaseUrl("openrouter", { OLLAMA_BASE_URL: "http://evil" }),
    ).toBe(PROVIDERS.openrouter.baseUrl);
  });

  it("has nothing to say about the native SDKs", () => {
    expect(providerBaseUrl("anthropic", {})).toBeUndefined();
  });
});

describe("isPlausibleKey", () => {
  it("catches a key pasted for the wrong provider", () => {
    expect(isPlausibleKey("anthropic", "sk-ant-abcdefghijklmnop")).toBe(true);
    expect(isPlausibleKey("anthropic", "sk-abcdefghijklmnop")).toBe(false);
    expect(isPlausibleKey("openrouter", "sk-or-abcdefghijklmnop")).toBe(true);
  });

  it("rejects the obvious mistakes", () => {
    expect(isPlausibleKey("openai", "")).toBe(false);
    expect(isPlausibleKey("openai", "my key with spaces")).toBe(false);
  });

  it("lets a local server through with nothing", () => {
    expect(isPlausibleKey("ollama", "")).toBe(true);
  });
});
