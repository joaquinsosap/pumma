import { describe, expect, it } from "vitest";
import { z } from "zod";
import { refusal, title } from "@/lib/validation";

describe("what a refused input is told", () => {
  const refused = (schema: z.ZodTypeAny, value: unknown) => {
    const parsed = schema.safeParse(value);
    if (parsed.success) throw new Error("expected a refusal");
    return refusal(parsed.error);
  };

  it("says a title is too long, and what the limit is", () => {
    expect(refused(z.object({ title }), { title: "x".repeat(201) })).toBe(
      "That is too long. The limit is 200 characters.",
    );
  });

  it("takes a title at the limit", () => {
    expect(title.safeParse("x".repeat(200)).success).toBe(true);
  });

  it("says no more than Invalid input about anything else", () => {
    expect(refused(z.object({ title }), { title: "" })).toBe("Invalid input");
    expect(refused(z.object({ n: z.number().max(3) }), { n: 9 })).toBe(
      "Invalid input",
    );
  });
});
