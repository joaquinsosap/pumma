// What a read of Jira tells the owner, and when it says nothing.
import { describe, expect, it } from "vitest";
import { syncHint, syncSaid } from "@/lib/jira/sync-said";

const ok = (moved: number) =>
  ({ state: "ok", read: 4, moved, capped: false, nextAt: 0 }) as const;

describe("after a read nobody asked for", () => {
  it("says how many tasks moved", () => {
    expect(syncSaid(ok(1), false)).toEqual({
      tone: "good",
      text: "1 task moved to match Jira",
    });
    expect(syncSaid(ok(3), false)?.text).toBe("3 tasks moved to match Jira");
  });

  it("says nothing when nothing moved, or nothing was read, or it failed", () => {
    expect(syncSaid(ok(0), false)).toBeNull();
    expect(syncSaid({ state: "waiting", nextAt: 0 }, false)).toBeNull();
    expect(syncSaid({ state: "nothing" }, false)).toBeNull();
    expect(
      syncSaid({ state: "failed", error: "Jira did not accept that token.", nextAt: 0 }, false),
    ).toBeNull();
  });
});

describe("after pressing the button", () => {
  it("answers even when nothing moved", () => {
    expect(syncSaid(ok(0), true)?.text).toBe("Jira has nothing new");
  });

  it("says a read a moment ago is not repeated", () => {
    expect(syncSaid({ state: "waiting", nextAt: 0 }, true)?.text).toMatch(
      /a moment ago/,
    );
  });

  it("passes on what Jira said when it failed", () => {
    expect(
      syncSaid({ state: "failed", error: "Jira did not accept that token.", nextAt: 0 }, true),
    ).toEqual({ tone: "bad", text: "Jira did not accept that token." });
  });

  it("says where to connect a Jira when none is", () => {
    expect(syncSaid({ state: "no-connection" }, true)?.text).toMatch(/Settings/);
  });
});

describe("the hint on the button", () => {
  it("says what it does before the first read", () => {
    expect(syncHint(null, "UTC")).toBe("Read this project's tickets from Jira");
  });

  it("says when Jira was last read, on the owner's clock", () => {
    const at = Date.UTC(2026, 10, 11, 14, 5);
    expect(syncHint(at, "UTC")).toBe("Read from Jira at 14:05. Press to read again.");
    expect(syncHint(at, "America/Montevideo")).toBe(
      "Read from Jira at 11:05. Press to read again.",
    );
  });
});
