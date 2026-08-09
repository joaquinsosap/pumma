// The only place the app talks to a model. Everything provider-specific stops
// here: call sites pass a schema and two blocks of system text and get back a
// validated object plus token usage.
import "server-only";
import type * as z from "zod/v4";
import {
  generateObject,
  NoObjectGeneratedError,
  type LanguageModel,
  type SystemModelMessage,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { recordAiUsage } from "@/lib/ai/quota";
import {
  resolveAiCredentials,
  NO_API_KEY_MESSAGE,
  type AiCredentials,
} from "@/lib/ai/api-key";
import { providerDef } from "@/lib/ai/providers";

/** Bounded latency: a stuck request should fail in ~1 min, not hang a page. */
const TIMEOUT_MS = 60_000;

export type StructuredMessages = {
  /** Static instructions — cached by providers that can. */
  cacheable: string;
  /** Volatile context (the user's data). Never part of the cached prefix. */
  volatile: string;
};

export type GenerateStructuredOptions<T> = {
  userId: string;
  schema: z.ZodType<T>;
  system: StructuredMessages;
  prompt: string;
  maxTokens: number;
  /** Shown when the model runs out of room. Wording differs per feature. */
  tooLongMessage: string;
  /** Shown when the model won't answer. */
  refusalMessage: string;
  /** Shown when nothing schema-shaped came back, even after a retry. */
  invalidMessage: string;
};

/**
 * Ask the user's chosen model for an object matching `schema`.
 *
 * Providers below "strict" structured output can return valid JSON that doesn't
 * match the schema, so a failure to parse is retried once with a blunt reminder
 * appended. One retry converts most of those; looping would just spend the
 * user's money on a model that can't do it.
 */
export async function generateStructured<T>(
  opts: GenerateStructuredOptions<T>,
): Promise<{
  object: T;
  usage: { inputTokens: number; outputTokens: number };
}> {
  const creds = await resolveAiCredentials(opts.userId);
  if (!creds) throw new Error(NO_API_KEY_MESSAGE);

  const model = buildModel(creds);
  // Every provider gets the schema-mismatch retry: even Anthropic runs in
  // jsonTool mode here (see providerOptions below), where adherence is very
  // good but not grammar-guaranteed.
  const canRetry = true;

  const run = (extra?: string) =>
    generateObject({
      model,
      schema: opts.schema,
      // An array of system messages so the static block can carry Anthropic's
      // cache_control while the volatile block stays outside the cached prefix.
      instructions: systemMessages(creds, opts.system, extra),
      prompt: opts.prompt,
      maxOutputTokens: opts.maxTokens,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      maxRetries: 1,
      providerOptions: {
        // Tool-calling mode instead of grammar-compiled structured outputs.
        // The grammar compiler enforces hard caps (24 optionals, 16 unions,
        // total size) that a nine-widget × three-op union can never fit;
        // jsonTool has no such limits.
        anthropic: { structuredOutputMode: "jsonTool" },
      },
    });

  let result;
  try {
    result = await run();
  } catch (error) {
    if (!canRetry || !NoObjectGeneratedError.isInstance(error)) {
      throw describeFailure(error, creds, opts);
    }
    debugDump("first attempt failed schema validation", error);
    try {
      // Hand the model its own validation error. A generic "try again" makes
      // it repeat the same mistake; the specific complaint gets it fixed.
      result = await run(
        [
          "Your previous reply was rejected. Fix exactly this and reply again:",
          validationDetail(error),
          "Return JSON matching the schema — no prose, no markdown fence.",
        ].join("\n\n"),
      );
    } catch (retryError) {
      debugDump("retry failed too", retryError);
      // The second failure is the one the user sees, so it gets the same
      // translation as the first — otherwise the SDK's own wording leaks out.
      throw describeFailure(retryError, creds, opts);
    }
  }

  const usage = {
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
  };
  await recordAiUsage(opts.userId, usage);

  if (result.finishReason === "length") throw new Error(opts.tooLongMessage);
  if (result.finishReason === "content-filter")
    throw new Error(opts.refusalMessage);
  if (!result.object) throw new Error(opts.invalidMessage);

  return { object: result.object, usage };
}

function systemMessages(
  creds: AiCredentials,
  system: StructuredMessages,
  extra?: string,
): SystemModelMessage[] {
  const def = providerDef(creds.provider);
  const messages: SystemModelMessage[] = [
    {
      role: "system",
      content: system.cacheable,
      // Repeat calls reuse the prefill once the prompt exceeds the model's
      // minimum cacheable size (silently a no-op below it).
      ...(def.promptCache
        ? {
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          }
        : {}),
    },
    { role: "system", content: system.volatile },
  ];
  if (extra) messages.push({ role: "system", content: extra });
  return messages;
}

function buildModel(creds: AiCredentials): LanguageModel {
  const def = providerDef(creds.provider);
  switch (def.sdk) {
    case "anthropic":
      return createAnthropic({ apiKey: creds.apiKey })(creds.model);
    case "openai":
      // The Responses API is the default; structured output is strict there.
      return createOpenAI({ apiKey: creds.apiKey })(creds.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: creds.apiKey })(creds.model);
    case "openai-compatible":
      return createOpenAICompatible({
        name: def.id,
        baseURL: creds.baseUrl ?? def.baseUrl ?? "",
        // Local servers reject an Authorization header they didn't ask for.
        ...(creds.apiKey ? { apiKey: creds.apiKey } : {}),
      })(creds.model);
  }
}

/**
 * Turn an SDK error into something worth showing a person.
 *
 * With bring-your-own keys across nine providers, most failures are the key or
 * the account rather than the app — saying which one saves a support thread.
 */
function describeFailure<T>(
  error: unknown,
  creds: AiCredentials,
  opts: GenerateStructuredOptions<T>,
): Error {
  const label = providerDef(creds.provider).label;
  if (NoObjectGeneratedError.isInstance(error)) {
    return new Error(opts.invalidMessage);
  }

  const status = statusOf(error);
  if (status === 401 || status === 403) {
    return new Error(
      `${label} rejected your API key. Check it in Settings → Assistant.`,
    );
  }
  if (status === 404) {
    return new Error(
      `${label} doesn't know the model "${creds.model}". Pick another in Settings → Assistant.`,
    );
  }
  if (status === 429) {
    return new Error(`${label} is rate-limiting your key. Try again shortly.`);
  }
  if (status === 402) {
    return new Error(`Your ${label} account is out of credit.`);
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return new Error(`${label} took too long to answer. Try again.`);
  }
  if (isConnectionError(error)) {
    return new Error(
      `Could not reach ${label}${
        creds.provider === "ollama" ? ", is it running?" : "."
      }`,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const withStatus = error as { statusCode?: number; status?: number };
  return withStatus.statusCode ?? withStatus.status;
}

function isConnectionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const message = String((error as { message?: string }).message ?? "");
  return /ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(message);
}

/**
 * AI_DEBUG=1 prints what the model actually said when it fails validation.
 * Off by default: the raw text can contain the user's own data.
 */
function debugDump(stage: string, error: unknown): void {
  if (process.env.AI_DEBUG !== "1") return;
  const detail = NoObjectGeneratedError.isInstance(error)
    ? `finish=${error.finishReason}\ntext=${String(error.text ?? "").slice(0, 4000)}\ncause=${String(error.cause ?? "").slice(0, 2000)}`
    : String(error);
  console.error(`\n[ai-debug] ${stage}\n${detail}\n`);
}

/**
 * The part of a validation failure worth showing the model: what it sent that
 * the schema rejected, and why. Trimmed hard — the whole payload back would
 * bury the complaint it needs to act on.
 */
function validationDetail(error: unknown): string {
  if (!NoObjectGeneratedError.isInstance(error))
    return "The reply did not match the schema.";
  const cause = String(error.cause ?? "");
  // Zod's message lives after "Error message:" in the SDK's wrapper.
  const zod = cause.split("Error message:")[1] ?? cause;
  return zod.trim().slice(0, 1500) || "The reply did not match the schema.";
}
