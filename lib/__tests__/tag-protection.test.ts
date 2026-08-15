import { describe, expect, it } from "vitest";
import { isBuiltInTag, tagDeleteBlock } from "@/lib/tag-protection";

describe("tagDeleteBlock", () => {
  it("refuses the two life tags, whatever their stored flag says", () => {
    // The bug this replaces: an account whose life tags predate `isDefault`
    // was offered a delete button the server then refused.
    expect(tagDeleteBlock({ name: "personal" })).toMatch(/life tag/);
    expect(tagDeleteBlock({ name: "work" })).toMatch(/life tag/);
    expect(tagDeleteBlock({ name: "PERSONAL" })).toMatch(/life tag/);
    expect(tagDeleteBlock({ name: " work " })).toMatch(/life tag/);
  });

  it("refuses a project's own tag and says what to do instead", () => {
    expect(tagDeleteBlock({ name: "website", isProjectPrimary: true })).toMatch(
      /delete the project/,
    );
  });

  it("allows an ordinary tag, including one a stale flag once protected", () => {
    // "notes" carried isDefault: true on a real account and could not be
    // deleted. It is an ordinary label and must be deletable.
    expect(tagDeleteBlock({ name: "notes" })).toBeNull();
    expect(tagDeleteBlock({ name: "idea" })).toBeNull();
  });
});

describe("isBuiltInTag", () => {
  it("badges only the life tags", () => {
    expect(isBuiltInTag({ name: "personal" })).toBe(true);
    expect(isBuiltInTag({ name: "work" })).toBe(true);
    expect(isBuiltInTag({ name: "notes" })).toBe(false);
    expect(isBuiltInTag({ name: "finance" })).toBe(false);
  });
});

describe("what the auto-cleaner may sweep", () => {
  // findUnusedTags filters on tagDeleteBlock, so these are the same rulings
  // the sweep obeys. The project-primary case is the one that was open: an
  // unused project tag was eligible for automatic deletion, and a project is
  // required to keep exactly one.
  const sweepable = (tag: { name: string; isProjectPrimary?: boolean }) =>
    tagDeleteBlock(tag) === null;

  it("never sweeps a life tag or a project's own tag", () => {
    expect(sweepable({ name: "work" })).toBe(false);
    expect(sweepable({ name: "personal" })).toBe(false);
    expect(sweepable({ name: "website", isProjectPrimary: true })).toBe(false);
  });

  it("may sweep an ordinary unused tag", () => {
    expect(sweepable({ name: "leftover" })).toBe(true);
  });
});
