// The daily AI cap, exercised through its memory path. The rule under test is
// the arithmetic and the keying — one counter per user per day, a hard stop
// at the limit — which is identical in the Mongo path; only the storage
// differs there ($inc instead of a Map).
import { describe, expect, it } from "vitest";
import { reserveAiCall } from "@/lib/ai/quota";

// DAILY_LIMIT is read from env at module load; the default is 50.
const LIMIT = 50;

describe("reserveAiCall (memory mode)", () => {
  it("grants exactly the limit and refuses the call after it", async () => {
    for (let i = 1; i <= LIMIT; i++) {
      expect(await reserveAiCall("quota-user-a")).toBe(true);
    }
    expect(await reserveAiCall("quota-user-a")).toBe(false);
    // Still refused — going over once must not reset anything.
    expect(await reserveAiCall("quota-user-a")).toBe(false);
  });

  it("counts each user separately", async () => {
    for (let i = 0; i <= LIMIT; i++) await reserveAiCall("quota-user-b");
    expect(await reserveAiCall("quota-user-b")).toBe(false);
    // A different account is untouched by someone else's spending.
    expect(await reserveAiCall("quota-user-c")).toBe(true);
  });
});
