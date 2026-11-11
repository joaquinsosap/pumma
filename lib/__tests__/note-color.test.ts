import { describe, expect, it } from "vitest";
import { NOTE_COLORS, noteColorName, noteColorPick } from "@/lib/note-color";
import { PROJECT_COLORS } from "@/lib/project-colors";

describe("the colour a note can be saved with", () => {
  it("is any colour of the palette projects pick from", () => {
    expect(NOTE_COLORS).toEqual([...PROJECT_COLORS]);
    for (const color of NOTE_COLORS) expect(noteColorPick(color)).toBe(color);
  });

  it("can be taken off again", () => {
    expect(noteColorPick(null)).toBeNull();
  });

  it("is refused when it is not one of the palette", () => {
    expect(noteColorPick("red")).toBeUndefined();
    expect(noteColorPick("oklch(0.5 0.3 10)")).toBeUndefined();
    expect(noteColorPick("url(https://example.com/x)")).toBeUndefined();
    expect(noteColorPick(undefined)).toBeUndefined();
    expect(noteColorPick(3)).toBeUndefined();
  });
});

describe("a palette colour's name", () => {
  it("is the plain word a swatch is labelled with", () => {
    expect(noteColorName(PROJECT_COLORS[0])).toBe("red");
    expect(noteColorName(PROJECT_COLORS[4])).toBe("green");
  });

  it("falls back for a colour outside the palette", () => {
    expect(noteColorName("oklch(0.5 0.3 10)")).toBe("this color");
  });
});
