import { describe, it, expect } from "vitest";
import { OBFUSCATE_POOL, bucketByWidth, obfuscate } from "@/lib/obfuscate";

// A fake font: "i" and "l" are narrow, "m" and "w" wide, the rest one width.
const width = (ch: string) => ("il".includes(ch) ? 2 : "mw".includes(ch) ? 8 : 5);
const buckets = bucketByWidth(["i", "l", "m", "w", "a", "b", "c"], width);

describe("obfuscate", () => {
  it("swaps each character for one of the same width", () => {
    for (let n = 0; n < 50; n++) {
      const out = obfuscate("mail", buckets);
      expect([...out].map(width)).toEqual([..."mail"].map(width));
    }
  });

  it("keeps the length", () => {
    expect(obfuscate("errands", buckets)).toHaveLength(7);
  });

  it("draws from the whole pool before the font is measured", () => {
    const out = obfuscate("ab", null, () => 0);
    expect(out).toBe(OBFUSCATE_POOL[0].repeat(2));
  });

  it("falls back to the whole pool for a character it never measured", () => {
    const out = obfuscate("z", buckets, () => 0.999);
    expect(out).toBe(OBFUSCATE_POOL[OBFUSCATE_POOL.length - 1]);
  });

  it("leaves out the soft hyphen, which draws nothing", () => {
    expect(OBFUSCATE_POOL).not.toContain("­");
  });
});

describe("bucketByWidth", () => {
  it("groups characters that draw the same width", () => {
    expect(buckets.byWidth.get(2)).toEqual(["i", "l"]);
    expect(buckets.byWidth.get(8)).toEqual(["m", "w"]);
  });

  it("treats widths within half a pixel as equal", () => {
    const b = bucketByWidth(["x", "y"], (ch) => (ch === "x" ? 5.1 : 4.9));
    expect(b.byWidth.get(5)).toEqual(["x", "y"]);
  });
});
