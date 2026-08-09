"use server";

import * as z from "zod/v4";
import type { ActionResult } from "@/lib/types";
import { requireUserId } from "@/lib/auth/session";
import { AI_QUOTA_MESSAGE, reserveAiCall } from "@/lib/ai/quota";
import { generateStructured } from "@/lib/ai/generate";
import { resolveAiCredentials } from "@/lib/ai/api-key";
import { providerDef } from "@/lib/ai/providers";

// Deliberately the smallest schema that still proves structured output works:
// a model that can't be held to one field can't produce a plan either.
const pingSchema = z.object({
  ok: z.literal(true),
  word: z.string(),
});

/**
 * One cheap round-trip against the user's configured provider.
 *
 * With bring-your-own keys across nine providers, "it didn't work" is usually
 * the key, the model name, or the account — this turns that into one sentence
 * instead of a failed plan ten seconds into someone's first try.
 */
export async function testAiConnectionAction(): Promise<
  ActionResult<{ provider: string; model: string }>
> {
  const userId = await requireUserId();
  const creds = await resolveAiCredentials(userId);
  if (!creds) {
    return { ok: false, error: "Add a key first, then test the connection." };
  }
  // A test costs tokens like anything else, so it counts against the day.
  if (!(await reserveAiCall(userId))) {
    return { ok: false, error: AI_QUOTA_MESSAGE };
  }

  try {
    await generateStructured({
      userId,
      schema: pingSchema,
      system: {
        cacheable:
          "You are a connection test. Reply with the object you are asked for.",
        volatile: "",
      },
      prompt: 'Return {"ok": true, "word": "pong"}.',
      maxTokens: 200,
      tooLongMessage:
        "The model answered, but ran out of room. It should still work.",
      refusalMessage:
        "The model declined a harmless test. Try a different model.",
      invalidMessage:
        "Connected, but the model couldn't follow a simple schema. Plan and Ask need a stronger model.",
    });
    return {
      ok: true,
      data: { provider: providerDef(creds.provider).label, model: creds.model },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The test call failed.",
    };
  }
}
