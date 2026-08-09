import { describe, it, expect } from "vitest";
import {
  tokenAtCaret,
  candidatesFor,
  commonPrefix,
  completeOmniToken,
} from "@/lib/omni-complete";

const tags = [
  "website-app",
  "website-site",
  "website-store",
  "art",
  "work",
  "personal",
  "ai-tools",
  "open-ai",
];

describe("tokenAtCaret", () => {
  it("finds the partial tag being typed", () => {
    expect(tokenAtCaret("review #web", 11)).toEqual({
      prefix: "#",
      word: "web",
      start: 7,
    });
  });

  it("finds a partial priority", () => {
    expect(tokenAtCaret("pay rent !hi", 12)?.word).toBe("hi");
  });

  it("ignores tokens the caret has moved past", () => {
    expect(tokenAtCaret("#art and", 8)).toBeNull();
  });

  it("returns null with no token", () => {
    expect(tokenAtCaret("buy milk", 8)).toBeNull();
  });
});

describe("candidatesFor", () => {
  it("returns everything still possible", () => {
    expect(candidatesFor("website", tags)).toEqual([
      "website-app",
      "website-site",
      "website-store",
    ]);
  });

  it("narrows as more is typed", () => {
    expect(candidatesFor("website-s", tags)).toEqual([
      "website-site",
      "website-store",
    ]);
  });

  it("prefers prefix matches over substrings", () => {
    // "open-ai" contains "ai" but "ai-tools" starts with it.
    expect(candidatesFor("ai", tags)).toEqual(["ai-tools"]);
  });

  it("falls back to substrings when nothing starts with it", () => {
    expect(candidatesFor("pen", tags)).toEqual(["open-ai"]);
  });
});

describe("commonPrefix", () => {
  it("returns what every option agrees on", () => {
    expect(commonPrefix(["website-app", "website-site"])).toBe("website-");
  });

  it("handles one option and none", () => {
    expect(commonPrefix(["art"])).toBe("art");
    expect(commonPrefix([])).toBe("");
  });

  it("is empty when nothing is shared", () => {
    expect(commonPrefix(["art", "work"])).toBe("");
  });
});

describe("completeOmniToken", () => {
  it("fills in only as far as the options agree", () => {
    const out = completeOmniToken("review #web", 11, tags);
    expect(out?.text).toBe("review #website-");
    expect(out?.exact).toBe(false);
    // No trailing space: the tag isn't finished yet.
    expect(out?.caret).toBe(16);
  });

  it("finishes and spaces out when one option is left", () => {
    const out = completeOmniToken("review #ar", 10, tags);
    expect(out?.text).toBe("review #art ");
    expect(out?.exact).toBe(true);
    // Caret sits after the space, ready for prose.
    expect(out?.caret).toBe(12);
  });

  it("rotates through the options on repeat presses", () => {
    const first = completeOmniToken("x #website-", 11, tags, 0);
    const second = completeOmniToken("x #website-", 11, tags, 1);
    const third = completeOmniToken("x #website-", 11, tags, 2);
    expect([first?.completion, second?.completion, third?.completion]).toEqual([
      "website-app",
      "website-site",
      "website-store",
    ]);
  });

  it("wraps around when rotating past the end", () => {
    expect(completeOmniToken("x #website-", 11, tags, 3)?.completion).toBe(
      "website-app",
    );
  });

  it("narrows again once more is typed", () => {
    // "website-st" leaves only one, so it finishes outright.
    const out = completeOmniToken("x #website-st", 13, tags);
    expect(out?.text).toBe("x #website-store ");
    expect(out?.exact).toBe(true);
  });

  it("completes priorities and spaces them out", () => {
    expect(completeOmniToken("pay rent !hi", 12, tags)?.text).toBe(
      "pay rent !high ",
    );
    expect(completeOmniToken("pay rent !m", 11, tags)?.text).toBe(
      "pay rent !mid ",
    );
  });

  it("keeps text after the caret and doesn't double a space", () => {
    const out = completeOmniToken("review #ar later", 10, tags);
    expect(out?.text).toBe("review #art later");
  });

  it("does nothing when there's nothing to complete", () => {
    expect(completeOmniToken("buy milk", 8, tags)).toBeNull();
    expect(completeOmniToken("review #", 8, tags)).toBeNull();
    expect(completeOmniToken("review #zzz", 11, tags)).toBeNull();
  });

  it("never completes a priority to a tag name", () => {
    expect(completeOmniToken("x !website", 10, tags)).toBeNull();
  });
});

describe("rotation over the originally typed prefix", () => {
  it("keeps cycling the full set after the first press rewrote the token", () => {
    // First press on "#web" fills the shared prefix.
    const first = completeOmniToken("x #web", 6, tags);
    expect(first?.text).toBe("x #website-");

    // Second press must still see all three, not just what "website-" matches
    // after the rewrite — that's why baseWord is threaded through.
    const second = completeOmniToken(first!.text, first!.caret, tags, 1, "web");
    const third = completeOmniToken(first!.text, first!.caret, tags, 2, "web");
    expect([second?.completion, third?.completion]).toEqual([
      "website-site",
      "website-store",
    ]);
  });

  it("rotates from a prefix that adds nothing", () => {
    // "h" is already the shared prefix of health/home-*, so it cycles at once.
    const pool = ["health", "home-office-setup"];
    expect(completeOmniToken("x #h", 4, pool)?.completion).toBe("health");
    expect(completeOmniToken("x #health", 9, pool, 1, "h")?.completion).toBe(
      "home-office-setup",
    );
  });
});

describe("an exact match does not end the cycle", () => {
  const pool = ["web", "website", "webhook"];

  it("steps past a candidate the token already equals", () => {
    // "#web" IS a tag, but two others still match — Tab moves on rather than
    // settling, since settling would hide them.
    expect(completeOmniToken("x #web", 6, pool)?.completion).toBe("website");
  });

  it("keeps alternating on repeat presses", () => {
    const a = completeOmniToken("x #web", 6, pool, 1, "web");
    const b = completeOmniToken("x #web", 6, pool, 2, "web");
    const c = completeOmniToken("x #web", 6, pool, 3, "web");
    expect([a?.completion, b?.completion, c?.completion]).toEqual([
      "website",
      "webhook",
      "web",
    ]);
  });

  it("never auto-spaces while options remain", () => {
    expect(completeOmniToken("x #web", 6, pool)?.exact).toBe(false);
  });

  it("settles only when one option is left", () => {
    const out = completeOmniToken("x #webh", 7, pool);
    expect(out?.text).toBe("x #webhook ");
    expect(out?.exact).toBe(true);
  });
});
