// The second step of a cascading delete.
//
// Deleting a project takes its tasks with it. In the app you see a dialog
// naming them; over MCP nobody sees anything, so the first call reports what
// would be lost and mints a handle, and only a call carrying that handle
// deletes.
//
// The rule that matters most is the one the MCP security guidance is explicit
// about: possession of a handle is NOT authentication. It is checked against
// the user id taken from the verified token, so a handle that leaks, or is
// guessed, still cannot be spent by anyone else.
//
// Runs against the in-memory store (DATA_SOURCE is not mongodb under test),
// which is the same code path shape as the Mongo one.
import { describe, expect, it } from "vitest";
import { stageDelete, redeemDelete, CONFIRM_TTL_MINUTES } from "@/lib/mcp/confirm";

const pending = (id = "p1") => ({
  entity: "project",
  id,
  summary: `project "X" and its 3 tasks`,
});

describe("delete confirmation handles", () => {
  it("redeems once, for the right thing, by the right user", async () => {
    const handle = await stageDelete("user-1", pending());
    const first = await redeemDelete("user-1", handle, {
      entity: "project",
      id: "p1",
    });
    expect(first.ok).toBe(true);
  });

  it("cannot be redeemed twice", async () => {
    // A retried call must not delete a second thing that has taken the
    // first one's place.
    const handle = await stageDelete("user-1", pending());
    expect((await redeemDelete("user-1", handle, { entity: "project", id: "p1" })).ok).toBe(true);
    const again = await redeemDelete("user-1", handle, { entity: "project", id: "p1" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toMatch(/unknown or already used/);
  });

  it("is bound to the user it was issued to", async () => {
    // The whole point: holding the handle proves nothing.
    const handle = await stageDelete("user-1", pending());
    const stolen = await redeemDelete("user-2", handle, {
      entity: "project",
      id: "p1",
    });
    expect(stolen.ok).toBe(false);
    if (!stolen.ok) expect(stolen.reason).toMatch(/not yours/);
  });

  it("only authorises the exact row it was issued for", async () => {
    // Otherwise a preview of a harmless project could be spent on a different
    // one, which is the confirmation step confirming nothing.
    const handle = await stageDelete("user-1", pending("p1"));
    const other = await redeemDelete("user-1", handle, {
      entity: "project",
      id: "p2",
    });
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.reason).toMatch(/issued for something else/);
  });

  it("refuses a handle nobody issued", async () => {
    const made_up = await redeemDelete("user-1", "not-a-real-handle", {
      entity: "project",
      id: "p1",
    });
    expect(made_up.ok).toBe(false);
  });

  it("issues handles that are unpredictable and distinct", async () => {
    const handles = await Promise.all(
      Array.from({ length: 50 }, () => stageDelete("user-1", pending())),
    );
    expect(new Set(handles).size).toBe(50);
    // Long enough not to be guessed inside its lifetime. Sequential or short
    // ids would turn the confirmation into a formality.
    for (const h of handles) expect(h.length).toBeGreaterThanOrEqual(20);
  });

  it("expires, rather than waiting indefinitely to authorise a delete", () => {
    expect(CONFIRM_TTL_MINUTES).toBeGreaterThan(0);
    expect(CONFIRM_TTL_MINUTES).toBeLessThanOrEqual(15);
  });
});
