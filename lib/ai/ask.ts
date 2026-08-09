// Server-only: answers a question about the user's data with structured gadgets.
import "server-only";
import { buildUserSnapshot } from "@/lib/ai/user-snapshot";
import { ASK_CONTEXT } from "@/lib/ai/ask-context";
import { enrichAskAnswer } from "@/lib/ai/enrich-ask";
import { askAnswerSchema, type AskResult } from "@/lib/ai/ask-schema";
import { generateStructured } from "@/lib/ai/generate";

export async function ask(
  userId: string,
  question: string,
): Promise<AskResult> {
  const { json, dataMode, data } = await buildUserSnapshot(userId);

  const { object } = await generateStructured({
    userId,
    schema: askAnswerSchema,
    // Static instructions are the cacheable half; the data block sits after
    // them so it can't invalidate the cached prefix.
    system: {
      cacheable: ASK_CONTEXT,
      volatile: `# The user's data (JSON)\n${json}`,
    },
    prompt: question,
    maxTokens: 8000,
    tooLongMessage: "The answer was too long. Try a more specific question.",
    refusalMessage: "The model declined to answer this request.",
    invalidMessage:
      "The model did not return a valid answer. Please try again.",
  });

  return { ...enrichAskAnswer(object, data), dataMode };
}
