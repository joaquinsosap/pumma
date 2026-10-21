import { describe, it, expect } from "vitest";
import { noteHref } from "@/lib/note-href";
import { hrefWithLife } from "@/lib/life-area";
import { hrefHasEntityFocus } from "@/lib/ask-links";

describe("noteHref", () => {
  it("selects a note with a query on the one notes page, never a path segment", () => {
    // A path per note is a new page to Next, remounted on the next refresh.
    expect(noteHref("6a53")).toBe("/notes?note=6a53");
  });

  it("keeps the life view alongside it", () => {
    expect(hrefWithLife(noteHref("6a53"), "work")).toBe("/notes?note=6a53&life=work");
  });

  it("escapes anything that is not a plain id", () => {
    expect(noteHref("a b&c")).toBe("/notes?note=a%20b%26c");
  });
});

describe("assistant links to notes", () => {
  it("count the query form and the old path as pointing at a note", () => {
    expect(hrefHasEntityFocus(noteHref("6a53"))).toBe(true);
    expect(hrefHasEntityFocus("/notes/6a53")).toBe(true);
    expect(hrefHasEntityFocus("/notes")).toBe(false);
  });
});
