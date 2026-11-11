import { describe, expect, it } from "vitest";
import { notePreview } from "@/lib/note-preview";
import { noteTitleFromBody } from "@/lib/parse";

/** A note as the capture bar makes it: the text is the body, its opening words the title. */
const captured = (text: string) => notePreview(noteTitleFromBody(text), text);

describe("what a note's card shows under its title", () => {
  it("shows nothing for a note that is only its title", () => {
    expect(captured("milk")).toBe("");
    expect(captured("groceries for sunday")).toBe("");
    expect(notePreview("milk", "  milk \n")).toBe("");
  });

  it("shows nothing for a note with no text", () => {
    expect(notePreview("Untitled", "")).toBe("");
    expect(notePreview("Untitled", "   \n ")).toBe("");
  });

  it("shows the lines after the first when the first line is the title", () => {
    expect(captured("Shopping list\nmilk\neggs\nbread")).toBe("milk\neggs\nbread");
  });

  it("carries on from where a cut title stopped", () => {
    expect(
      captured("call the plumber about the leak in the kitchen sink"),
    ).toBe("kitchen sink");
    // The cut drops the comma it stopped on; the card does not start with it.
    expect(captured("one two three four five six seven eight, nine ten")).toBe(
      "nine ten",
    );
  });

  it("never starts with the dash a cut title stopped on", () => {
    expect(captured("one two three four five six seven eight— nine ten")).toBe(
      "nine ten",
    );
  });

  it("carries on mid-word after a title clipped for length", () => {
    expect(captured("x".repeat(100))).toBe("x".repeat(28));
  });

  it("shows the whole text under a short title typed with an ellipsis", () => {
    expect(notePreview("Wait…", "Waiting for the bus")).toBe("Waiting for the bus");
    expect(notePreview("…", "Waiting for the bus")).toBe("Waiting for the bus");
  });

  it("shows the whole text under an empty title", () => {
    expect(notePreview("", "hello")).toBe("hello");
  });

  it("reads lines that end the Windows way", () => {
    expect(captured("Shopping\r\nmilk\r\neggs")).toBe("milk\r\neggs");
  });

  it("reads past uneven spacing in the text", () => {
    expect(notePreview("pay the rent", "pay   the rent\nbefore friday")).toBe(
      "before friday",
    );
  });

  it("shows the whole text under a title the note does not open with", () => {
    expect(notePreview("Ideas", "a podcast about solo founders")).toBe(
      "a podcast about solo founders",
    );
  });

  it("does not take a title for the start of a longer word or line", () => {
    expect(notePreview("milk", "milkshake recipe")).toBe("milkshake recipe");
    expect(notePreview("call the", "call the plumber")).toBe("call the plumber");
  });
});
