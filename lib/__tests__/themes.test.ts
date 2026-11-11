// The looks: every one has its colours, and a stored colour reads on all of them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEED_PALETTE, OWN_MEETING_COLOR } from "@/lib/calendar-colors";
import { PROJECT_COLORS } from "@/lib/project-colors";
import { LOOKS, lookFor, paint } from "@/lib/themes";
import { TAG_PALETTE } from "@/lib/types";

// Colour maths, enough to read a contrast off two CSS colours.
type Rgb = [number, number, number];
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gam = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp = (v: number) => Math.min(1, Math.max(0, v));
function toLab([r, g, b]: Rgb): Rgb {
  const [x, y, z] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * x + 0.5363325363 * y + 0.0514459929 * z);
  const m = Math.cbrt(0.2119034982 * x + 0.6806995451 * y + 0.1073969566 * z);
  const s = Math.cbrt(0.0883024619 * x + 0.2817188376 * y + 0.6299787005 * z);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromLab([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    clamp(gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp(gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp(gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ];
}
function rgb(css: string): Rgb {
  const hex = css.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16) / 255) as Rgb;
  const ok = css.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  if (!ok) throw new Error(`not a colour this test reads: ${css}`);
  const h = (Number(ok[3]) * Math.PI) / 180;
  return fromLab([Number(ok[1]), Number(ok[2]) * Math.cos(h), Number(ok[2]) * Math.sin(h)]);
}
const lum = (c: Rgb) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function toLch(c: Rgb): Rgb {
  const [L, a, b] = toLab(c);
  return [L, Math.hypot(a, b), Math.atan2(b, a)];
}
const inGamut = ([L, C, h]: Rgb) => {
  const l = (L + 0.3963377774 * C * Math.cos(h) + 0.2158037573 * C * Math.sin(h)) ** 3;
  const m = (L - 0.1055613458 * C * Math.cos(h) - 0.0638541728 * C * Math.sin(h)) ** 3;
  const s = (L - 0.0894841775 * C * Math.cos(h) - 1.291485548 * C * Math.sin(h)) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.every((v) => v >= -0.0005 && v <= 1.0005);
};
/**
 * What `paint` draws: the colour mixed in OKLCH with the look's hue-less
 * target, so the hue is the colour's own. A result the screen cannot show
 * loses strength until it can, the way a browser brings it back.
 */
function painted(color: Rgb, keep: number, [toL, toC]: [number, number]): Rgb {
  const [L, C, h] = toLch(color);
  const lch: Rgb = [keep * L + (1 - keep) * toL, keep * C + (1 - keep) * toC, h];
  while (lch[1] > 0 && !inGamut(lch)) lch[1] -= 0.002;
  return fromLab([lch[0], lch[1] * Math.cos(h), lch[1] * Math.sin(h)]);
}

const CSS = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
/** A look's own block of tokens in the stylesheet. */
function tokens(id: string): Record<string, string> {
  const block = CSS.match(new RegExp(`:root\\[data-palette="${id}"\\] \\{([^}]*)\\}`));
  if (!block) throw new Error(`no block for the look "${id}" in globals.css`);
  return Object.fromEntries(
    [...block[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}

const PICKABLE = [
  ...TAG_PALETTE,
  ...PROJECT_COLORS,
  ...FEED_PALETTE.map((c) => c.value),
  OWN_MEETING_COLOR,
];
const MATTE = LOOKS.filter((l) => l.finish === "matte");

describe("the looks", () => {
  it("gives every matte look its block of colours, and the swatch in the menu shows them", () => {
    for (const look of MATTE) {
      const t = tokens(look.id);
      expect([look.id, t["--bg"]]).toEqual([look.id, look.ground]);
      expect([look.id, t["--surface"]]).toEqual([look.id, look.card]);
      expect([look.id, t["--btn"]]).toEqual([look.id, look.button]);
    }
  });

  it("keeps every colour a person can pick readable on every ground of every matte look", () => {
    for (const look of MATTE) {
      const t = tokens(look.id);
      const keep = Number(t["--pick-keep"].replace("%", "")) / 100;
      const target: [number, number] = [Number(t["--pick-l"]), Number(t["--pick-c"])];
      expect([look.id, Number.isFinite(target[0]) && Number.isFinite(target[1])]).toEqual([look.id, true]);
      for (const ground of ["--bg", "--surface", "--surface2", "--floating", "--chip", "--band", "--well", "--face"]) {
        for (const color of PICKABLE) {
          const reads = contrast(painted(rgb(color), keep, target), rgb(t[ground]));
          expect([look.id, ground, color, reads >= 3]).toEqual([look.id, ground, color, true]);
        }
      }
    }
  });

  it("keeps text readable: the ink, its three quieter steps, and the text on a filled button", () => {
    for (const look of MATTE) {
      const t = tokens(look.id);
      // Text sits on cards and straight on the page; the lower of the two is what counts.
      const on = (token: string) =>
        Math.min(contrast(rgb(t[token]), rgb(t["--surface"])), contrast(rgb(t[token]), rgb(t["--bg"])));
      expect([look.id, "ink", on("--ink") >= 7]).toEqual([look.id, "ink", true]);
      expect([look.id, "muted", on("--muted") >= 6]).toEqual([look.id, "muted", true]);
      expect([look.id, "faint", on("--faint") >= 5]).toEqual([look.id, "faint", true]);
      expect([look.id, "faint2", on("--faint2") >= 4.5]).toEqual([look.id, "faint2", true]);
      expect([look.id, "accent", on("--primary") >= 4.5]).toEqual([look.id, "accent", true]);
      const button = contrast(rgb(t["--on-primary"]), rgb(t["--btn"]));
      expect([look.id, "button", button >= 4.5]).toEqual([look.id, "button", true]);
    }
  });

  it("names the same tokens in every matte look, so none falls back to Mist's for one of them", () => {
    const names = (id: string) => Object.keys(tokens(id)).sort();
    for (const look of MATTE) {
      expect([look.id, names(look.id)]).toEqual([look.id, names(MATTE[0].id)]);
    }
  });

  it("says light or dark the way its ground is", () => {
    for (const look of MATTE) {
      const dark = lum(rgb(tokens(look.id)["--bg"])) < 0.2;
      expect([look.id, look.mode]).toEqual([look.id, dark ? "dark" : "light"]);
    }
  });
});

describe("lookFor", () => {
  it("shows the look an account picked", () => {
    expect(lookFor({ look: "linen", theme: "light" }).id).toBe("linen");
  });

  it("goes by the old light and dark switch for an account that never picked one", () => {
    expect(lookFor({ look: null, theme: "light" }).id).toBe("mist");
    expect(lookFor({ look: null, theme: "dark" }).id).toBe("graphite");
  });

  it("shows Mist signed out, and for a look that is no longer on the list", () => {
    expect(lookFor(null).id).toBe("mist");
    expect(lookFor({ look: "sepia", theme: "light" }).id).toBe("mist");
    expect(lookFor({ look: "sepia", theme: "dark" }).id).toBe("graphite");
  });
});

describe("paint", () => {
  it("hands the colour to the look in front, which moves it by its own measure", () => {
    expect(paint("oklch(0.7 0.12 70)")).toBe(
      "color-mix(in oklch, oklch(0.7 0.12 70) var(--pick-keep), oklch(var(--pick-l) var(--pick-c) none))",
    );
  });

  it("draws a tint or a soft edge from the same colour", () => {
    expect(paint("oklch(0.7 0.12 70)", 0.12)).toBe(
      "color-mix(in oklab, color-mix(in oklch, oklch(0.7 0.12 70) var(--pick-keep), oklch(var(--pick-l) var(--pick-c) none)) 12%, transparent)",
    );
  });

  it("keeps a colour strong when a look moves it", () => {
    // What is modelled here is the mix and the screen's range. The hue is not:
    // it stays by construction, as long as the target has none (the test below).
    for (const look of MATTE) {
      const t = tokens(look.id);
      const keep = Number(t["--pick-keep"].replace("%", "")) / 100;
      const target: [number, number] = [Number(t["--pick-l"]), Number(t["--pick-c"])];
      const strength = (color: string) =>
        toLch(painted(rgb(color), keep, target))[1] / toLch(rgb(color))[1];
      for (const color of [...TAG_PALETTE, ...PROJECT_COLORS]) {
        expect([look.id, color, strength(color) >= 0.8]).toEqual([look.id, color, true]);
      }
      // A screen cannot show a deep teal at full strength, so a calendar's colour may give up more.
      for (const { value } of FEED_PALETTE) {
        expect([look.id, value, strength(value) >= 0.6]).toEqual([look.id, value, true]);
      }
    }
  });

  it("never names a hue-less colour in the stylesheet, where the build would give it a hue", () => {
    // Any form: oklch or lch, with numbers or with var(), in any case. `none` just before a
    // closing bracket is a missing colour component; nothing else in the stylesheet ends that way.
    expect(CSS.includes("--pick-to")).toBe(false);
    expect(/none\s*\)/i.test(CSS)).toBe(false);
  });

  it("writes the hue-less target in the inline style, from the look's two numbers", () => {
    expect(paint("#888888")).toContain("oklch(var(--pick-l) var(--pick-c) none)");
  });

  it("moves nothing on Mist, so there a painted colour is the colour itself", () => {
    const root = CSS.match(/--pick-keep: (\d+)%;/);
    expect(root?.[1]).toBe("100");
  });
});
