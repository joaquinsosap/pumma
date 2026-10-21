// generateStructured's path for Claude models that refuse a forced tool call, with the model replies faked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod/v4";

const state = vi.hoisted(() => ({ model: "claude-opus-5-5" }));

vi.mock("@/lib/ai/api-key", () => ({
  NO_API_KEY_MESSAGE: "no key",
  resolveAiCredentials: async () => ({
    provider: "anthropic",
    model: state.model,
    apiKey: "sk-ant-test",
  }),
}));
vi.mock("@/lib/ai/quota", () => ({ recordAiUsage: async () => {} }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: vi.fn(),
  generateObject: vi.fn(),
}));

import { generateObject, generateText } from "ai";
import { generateStructured } from "@/lib/ai/generate";

const schema = z.object({ ok: z.literal(true), word: z.string() });
const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

/** A faked generateText reply: one json tool call with `input`, or none. */
function reply(input: unknown, finishReason = "tool-calls") {
  return {
    toolCalls: input === undefined ? [] : [{ type: "tool-call", toolCallId: "c1", toolName: "json", input }],
    totalUsage: usage,
    usage,
    finishReason,
    response: { id: "r1", timestamp: new Date(0), modelId: state.model },
    text: input === undefined ? "Here you go." : "",
  } as never;
}

const call = () =>
  generateStructured({
    userId: "u1",
    schema,
    system: { cacheable: "Be brief.", volatile: "" },
    prompt: "ping",
    maxTokens: 200,
    tooLongMessage: "TOO LONG",
    refusalMessage: "REFUSED",
    invalidMessage: "INVALID",
  });

beforeEach(() => {
  state.model = "claude-opus-5-5";
  vi.mocked(generateText).mockReset();
  vi.mocked(generateObject).mockReset();
});

describe("models that refuse a forced tool call", () => {
  it("offers the json tool unforced and returns its validated input", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(reply({ ok: true, word: "pong" }));
    const out = await call();
    expect(out.object).toEqual({ ok: true, word: "pong" });
    const args = vi.mocked(generateText).mock.calls[0][0] as {
      toolChoice: string;
      tools: Record<string, unknown>;
    };
    expect(args.toolChoice).toBe("auto");
    expect(Object.keys(args.tools)).toEqual(["json"]);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("retries once with the schema complaint when the input does not match", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce(reply({ ok: false, word: 3 }))
      .mockResolvedValueOnce(reply({ ok: true, word: "pong" }));
    const out = await call();
    expect(out.object).toEqual({ ok: true, word: "pong" });
    const retry = vi.mocked(generateText).mock.calls[1][0] as {
      instructions: { content: string }[];
    };
    const told = retry.instructions.map((m) => m.content).join("\n");
    expect(told).toContain("Your previous reply was rejected");
    expect(told).toContain("word");
  });

  it("gives up with the invalid message when no tool call comes twice", async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce(reply(undefined, "stop"))
      .mockResolvedValueOnce(reply(undefined, "stop"));
    await expect(call()).rejects.toThrow("INVALID");
  });

  it("says the reply ran out of room instead of retrying", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(reply(undefined, "length"));
    await expect(call()).rejects.toThrow("TOO LONG");
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("sends no empty system block when there is no data", async () => {
    vi.mocked(generateText).mockResolvedValueOnce(reply({ ok: true, word: "pong" }));
    await call();
    const args = vi.mocked(generateText).mock.calls[0][0] as {
      instructions: { content: string }[];
    };
    expect(args.instructions.every((m) => m.content.length > 0)).toBe(true);
  });
});

describe("models that take a forced tool call", () => {
  it("keep the jsonTool path", async () => {
    state.model = "claude-haiku-5-5";
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: { ok: true, word: "pong" },
      usage,
      finishReason: "tool-calls",
    } as never);
    const out = await call();
    expect(out.object).toEqual({ ok: true, word: "pong" });
    expect(generateText).not.toHaveBeenCalled();
  });
});
