// The paywall must hold at the session seam, not just in page layouts: with
// BILLING_ENABLED=1 an account without access (no subscription, not an owner,
// not a live demo) is redirected to /billing even when it calls a server
// action directly.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { resetStore } from "@/lib/store/memory";
import { addTask, renameTask } from "@/lib/actions/tasks";

afterEach(() => {
  delete process.env.BILLING_ENABLED;
  resetStore();
});

describe("billing access gate at the session seam", () => {
  it("billing off (default): actions pass", async () => {
    const res = await addTask({ text: "free task" });
    expect(res.ok).toBe(true);
  });

  it("billing armed: unpaid account is redirected from actions too", async () => {
    process.env.BILLING_ENABLED = "1";
    // next/navigation redirect() throws NEXT_REDIRECT with the target baked
    // into the digest — that throw escaping the action IS the gate working.
    await expect(addTask({ text: "blocked task" })).rejects.toMatchObject({
      digest: expect.stringContaining("/billing"),
    });
    await expect(renameTask("some-id", "x")).rejects.toMatchObject({
      digest: expect.stringContaining("/billing"),
    });
  });
});
