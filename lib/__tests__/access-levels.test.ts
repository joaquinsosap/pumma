// Who gets into a paid app is the one rule a test suite cannot leave to
// manual checking: every wrong answer is either a paying customer locked out
// or a stranger using the product for free. These pin lib/billing/access.ts,
// with the data layer mocked so each ruling is exercised in isolation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/users", () => ({ getUser: vi.fn() }));
vi.mock("@/lib/db/subscriptions", () => ({ getSubscriptionByUserId: vi.fn() }));

import { getAccessLevel } from "@/lib/billing/access";
import { getUser } from "@/lib/db/users";
import { getSubscriptionByUserId } from "@/lib/db/subscriptions";

const mockUser = vi.mocked(getUser);
const mockSub = vi.mocked(getSubscriptionByUserId);

const user = (over: Record<string, unknown> = {}) =>
  ({ id: "u1", name: "U", email: "u@example.com", ...over }) as never;
const sub = (status: string) =>
  ({ userId: "u1", status, provider: "gumroad" }) as never;

const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const PAST = new Date(Date.now() - 3_600_000).toISOString();

beforeEach(() => {
  process.env.BILLING_ENABLED = "1";
  process.env.OWNER_EMAILS = "owner@example.com, Second@Example.com";
  mockUser.mockResolvedValue(user());
  mockSub.mockResolvedValue(null);
});
afterEach(() => {
  delete process.env.BILLING_ENABLED;
  delete process.env.OWNER_EMAILS;
  vi.clearAllMocks();
});

describe("getAccessLevel", () => {
  it("treats everyone as an owner while the gate is off", async () => {
    process.env.BILLING_ENABLED = "0";
    expect(await getAccessLevel("u1")).toBe("owner");
    // The gate off means no lookups at all — self-host must not need these.
    expect(mockUser).not.toHaveBeenCalled();
    expect(mockSub).not.toHaveBeenCalled();
  });

  it("recognises an owner however their email is cased", async () => {
    mockUser.mockResolvedValue(user({ email: "OWNER@example.com" }));
    expect(await getAccessLevel("u1")).toBe("owner");
    mockUser.mockResolvedValue(user({ email: "second@example.com" }));
    expect(await getAccessLevel("u1")).toBe("owner");
  });

  it("lets a live demo in and an expired one no further", async () => {
    mockUser.mockResolvedValue(user({ isDemo: true, demoExpiresAt: FUTURE }));
    expect(await getAccessLevel("u1")).toBe("demo");
    mockUser.mockResolvedValue(user({ isDemo: true, demoExpiresAt: PAST }));
    expect(await getAccessLevel("u1")).toBe("none");
  });

  it("counts active, trialing and past_due as subscribed", async () => {
    // past_due deliberately keeps access: the provider is still retrying the
    // charge, and cutting someone off mid-retry punishes a flaky card.
    for (const status of ["active", "trialing", "past_due"]) {
      mockSub.mockResolvedValue(sub(status));
      expect(await getAccessLevel("u1")).toBe("subscribed");
    }
  });

  it("shuts the door on canceled and paused", async () => {
    for (const status of ["canceled", "paused"]) {
      mockSub.mockResolvedValue(sub(status));
      expect(await getAccessLevel("u1")).toBe("none");
    }
  });

  it("answers none for an account with nothing at all", async () => {
    mockUser.mockResolvedValue(null);
    expect(await getAccessLevel("u1")).toBe("none");
  });
});
