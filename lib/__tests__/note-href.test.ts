import { describe, it, expect } from "vitest";
import { noteHref } from "@/lib/note-href";
import { hrefWithLife } from "@/lib/life-area";

describe("noteHref", () => {
  it("selects a note with a query on the one notes page, never a path segment", () => {
    // A path per note made every note pick a different page to Next, which
    // remounted the editor on the next refresh and dropped focus mid-sentence.
    expect(noteHref("6a53")).toBe("/notes?note=6a53");
  });

  it("keeps the life view alongside it", () => {
    expect(hrefWithLife(noteHref("6a53"), "work")).toBe("/notes?note=6a53&life=work");
  });

  it("escapes anything that is not a plain id", () => {
    expect(noteHref("a b&c")).toBe("/notes?note=a%20b%26c");
  });
});
