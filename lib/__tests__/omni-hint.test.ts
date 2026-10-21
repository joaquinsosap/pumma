import { describe, it, expect } from "vitest";
import { omniHint, type OmniHintOptions } from "@/lib/omni-hint";
import { completeOmniToken } from "@/lib/omni-complete";

const typeWords = ["task", "habit", "goal", "note"];
const opts = (
  pool: string[],
  cycle?: { base: string; index: number },
): OmniHintOptions => ({ pool, typeWords, cycle });
const atEnd = (text: string, o: OmniHintOptions) =>
  omniHint(text, text.length, text.length, o);

describe("omniHint before Tab", () => {
  it("spells out the rest when one match is left", () => {
    expect(atEnd("pay rent #fin", opts(["finance", "health"]))).toEqual({
      kind: "certain",
      text: "ance",
      replace: false,
    });
  });

  it("finishes priorities the same way", () => {
    expect(atEnd("call !h", opts([]))).toEqual({
      kind: "certain",
      text: "igh",
      replace: false,
    });
  });

  it("scrambles when the matches differ right after what you typed", () => {
    // His example: wab, wib, web and "#w". Nothing shared after the w.
    expect(atEnd("#w", opts(["wab", "wib", "web"]))).toEqual({
      kind: "open",
      known: "",
      unknown: "ab",
      replace: false,
      count: 3,
      slot: 0,
    });
  });

  it("spells out the shared part and scrambles only the rest", () => {
    expect(atEnd("#web", opts(["website-app", "website-site"]))).toMatchObject({
      kind: "open",
      known: "site-",
      unknown: "app",
      count: 2,
    });
  });

  it("sizes the scramble like the option Tab actually writes first", () => {
    const pool = ["web", "website", "webhook"];
    expect(atEnd("x #web", opts(pool))).toMatchObject({ unknown: "site", slot: 1 });
    expect(completeOmniToken("x #web", 6, pool)?.completion).toBe("website");
  });

  it("names the word Tab swaps in for a match found inside the typed word", () => {
    expect(atEnd("#art", opts(["smart-home"]))).toEqual({
      kind: "certain",
      text: "smart-home",
      replace: true,
    });
    expect(completeOmniToken("#art", 4, ["smart-home"])?.text).toBe("#smart-home ");
  });

  it("scrambles several inside-the-word matches as a swap", () => {
    expect(atEnd("#ar", opts(["smart-home", "war-room"]))).toMatchObject({
      kind: "open",
      replace: true,
      unknown: "smart-home",
      count: 2,
    });
  });

  it("shows nothing for a word nothing matches, so Tab switches the type", () => {
    expect(atEnd("#zz", opts(["work"]))).toBeNull();
  });

  it("shows nothing for a bare #", () => {
    expect(atEnd("#", opts(["work"]))).toBeNull();
  });

  it("shows nothing on a type word spelled out, which Tab swaps", () => {
    expect(atEnd("#task", opts(["task", "tasks-later"]))).toBeNull();
  });

  it("shows nothing once the word is complete", () => {
    expect(atEnd("#work", opts(["work"]))).toBeNull();
  });

  it("shows nothing unless the caret is at the very end", () => {
    expect(omniHint("#fin later", 4, 4, opts(["finance"]))).toBeNull();
  });
});

describe("omniHint while Tab cycles", () => {
  const pool = ["garden", "gaming", "gallery"];

  it("counts which option the selected guess is", () => {
    // "#gaming" with "ming" selected, cycling from "ga", gaming written last.
    expect(omniHint("#gaming", 3, 7, opts(pool, { base: "ga", index: 1 }))).toEqual({
      kind: "cycling",
      position: 2,
      count: 3,
    });
  });

  it("after the guess is deleted, scrambles the option Tab goes on to", () => {
    // Backspace over "ming" leaves "#ga"; the next Tab writes gallery, not garden.
    const hint = atEnd("#ga", opts(pool, { base: "ga", index: 1 }));
    expect(hint).toMatchObject({ kind: "open", unknown: "llery", slot: 2 });
    expect(completeOmniToken("#ga", 3, pool, 2, "ga")?.completion).toBe("gallery");
  });

  it("follows a swap cycle after its guess is deleted", () => {
    // "#ar" wrote "#smart-home" leaving "#sm"; deleting the guess, Tab goes on to war-room.
    const hint = atEnd("#sm", opts(["smart-home", "war-room"], { base: "ar", index: 0 }));
    expect(hint).toMatchObject({ kind: "open", replace: true, unknown: "war-room" });
    expect(completeOmniToken("#sm", 3, ["smart-home", "war-room"], 1, "ar")?.completion).toBe(
      "war-room",
    );
  });

  it("scrambles the first option after a shared-part fill", () => {
    // "#web" filled to "#website-" with "site-" selected; the next press starts the list.
    expect(
      omniHint("#website-", 4, 9, opts(["website-app", "website-site"], { base: "web", index: -1 })),
    ).toMatchObject({ kind: "open", known: "", unknown: "app", slot: 0 });
  });

  it("ignores a selection that is not Tab's guess", () => {
    expect(omniHint("#gaming", 3, 7, opts(pool))).toBeNull();
  });
});
