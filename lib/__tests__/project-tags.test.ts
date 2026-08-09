import { describe, it, expect } from "vitest";
import {
  projectTagSlug,
  uniqueTagName,
  projectIdFromTags,
  withSingleProjectTag,
  withProjectPrimaryTag,
  tagsForProject,
  isProjectTag,
  splitTagsByProject,
} from "@/lib/project-tags";

const tags = [
  { id: "t-work", name: "work" },
  { id: "t-idea", name: "idea" },
  { id: "t-ai", name: "ai", projectId: "p-ai", isProjectPrimary: true },
  { id: "t-ml", name: "ml", projectId: "p-ai" },
  { id: "t-web", name: "web", projectId: "p-web", isProjectPrimary: true },
];

describe("projectTagSlug", () => {
  it("lowercases and dashes the project name", () => {
    expect(projectTagSlug("Game Dev Ops")).toBe("game-dev-ops");
    expect(projectTagSlug("Website redesign")).toBe("website-redesign");
    expect(projectTagSlug("Marketing")).toBe("marketing");
  });

  it("strips punctuation and accents", () => {
    expect(projectTagSlug("Café — rebuild!")).toBe("cafe-rebuild");
    expect(projectTagSlug("Q3/Q4 push")).toBe("q3q4-push");
  });

  it("collapses runs of spaces and dashes", () => {
    expect(projectTagSlug("  Side   app -- MVP ")).toBe("side-app-mvp");
  });

  it("falls back rather than returning nothing", () => {
    expect(projectTagSlug("!!!")).toBe("project");
    expect(projectTagSlug("")).toBe("project");
  });
});

describe("uniqueTagName", () => {
  it("returns the base when it's free", () => {
    expect(uniqueTagName("ai", ["work", "idea"])).toBe("ai");
  });

  it("numbers off a collision, ignoring case", () => {
    expect(uniqueTagName("ai", ["AI"])).toBe("ai2");
    expect(uniqueTagName("ai", ["ai", "ai2"])).toBe("ai3");
  });
});

describe("projectIdFromTags", () => {
  it("finds the project a tag files under", () => {
    expect(projectIdFromTags(["t-work", "t-ai"], tags)).toBe("p-ai");
  });

  it("returns null with no project tag", () => {
    expect(projectIdFromTags(["t-work", "t-idea"], tags)).toBeNull();
  });

  it("lets the last project tag win", () => {
    // Two shouldn't coexist, but if they do, the most recently added is the
    // one the user just asked for.
    expect(projectIdFromTags(["t-ai", "t-web"], tags)).toBe("p-web");
  });

  it("treats two tags of the SAME project as that project", () => {
    expect(projectIdFromTags(["t-ai", "t-ml"], tags)).toBe("p-ai");
  });
});

describe("withSingleProjectTag", () => {
  it("drops project tags belonging to other projects", () => {
    expect(withSingleProjectTag(["t-ai", "t-web"], "p-web", tags)).toEqual([
      "t-web",
    ]);
  });

  it("keeps every ordinary tag — those are shareable", () => {
    expect(
      withSingleProjectTag(["t-work", "t-idea", "t-ai"], "p-ai", tags),
    ).toEqual(["t-work", "t-idea", "t-ai"]);
  });

  it("keeps several tags of the same project", () => {
    expect(withSingleProjectTag(["t-ai", "t-ml"], "p-ai", tags)).toEqual([
      "t-ai",
      "t-ml",
    ]);
  });

  it("strips all project tags when nothing is kept", () => {
    expect(withSingleProjectTag(["t-work", "t-ai"], null, tags)).toEqual([
      "t-work",
    ]);
  });
});

describe("tagsForProject", () => {
  it("returns the project's tags with the flagship first", () => {
    const out = tagsForProject(tags, "p-ai");
    expect(out.map((t) => t.name)).toEqual(["ai", "ml"]);
    expect(out[0].isProjectPrimary).toBe(true);
  });

  it("never returns another project's tags", () => {
    expect(tagsForProject(tags, "p-web").map((t) => t.name)).toEqual(["web"]);
  });
});

describe("isProjectTag", () => {
  it("is true only when a project owns it", () => {
    expect(isProjectTag(tags[0])).toBe(false);
    expect(isProjectTag(tags[2])).toBe(true);
  });
});

describe("splitTagsByProject", () => {
  it("keeps a single-project capture as one task", () => {
    expect(splitTagsByProject(["t-work", "t-ai", "t-ml"], tags)).toEqual([
      { projectId: "p-ai", tagIds: ["t-work", "t-ai", "t-ml"] },
    ]);
  });

  it("fans out across projects, each keeping only its own tags", () => {
    expect(splitTagsByProject(["t-ai", "t-web"], tags)).toEqual([
      { projectId: "p-ai", tagIds: ["t-ai"] },
      { projectId: "p-web", tagIds: ["t-web"] },
    ]);
  });

  it("puts unprojected tags on every copy", () => {
    // Life and ordinary tags aren't about projects, so both tasks get them.
    expect(
      splitTagsByProject(["t-work", "t-idea", "t-ai", "t-web"], tags),
    ).toEqual([
      { projectId: "p-ai", tagIds: ["t-work", "t-idea", "t-ai"] },
      { projectId: "p-web", tagIds: ["t-work", "t-idea", "t-web"] },
    ]);
  });

  it("gives one unfiled task when nothing is a project tag", () => {
    expect(splitTagsByProject(["t-work", "t-idea"], tags)).toEqual([
      { projectId: null, tagIds: ["t-work", "t-idea"] },
    ]);
  });

  it("handles no tags at all", () => {
    expect(splitTagsByProject([], tags)).toEqual([
      { projectId: null, tagIds: [] },
    ]);
  });

  it("orders buckets by the order the projects were typed", () => {
    expect(
      splitTagsByProject(["t-web", "t-ai"], tags).map((b) => b.projectId),
    ).toEqual(["p-web", "p-ai"]);
  });
});

describe("withProjectPrimaryTag", () => {
  it("adds the flagship tag when a task is filed under a project", () => {
    expect(withProjectPrimaryTag(["t-work"], "p-ai", tags)).toEqual([
      "t-work",
      "t-ai",
    ]);
  });

  it("adds nothing when the tag is already there", () => {
    expect(withProjectPrimaryTag(["t-ai"], "p-ai", tags)).toEqual(["t-ai"]);
  });

  it("adds only the flagship, never the project's other tags", () => {
    expect(withProjectPrimaryTag([], "p-ai", tags)).toEqual(["t-ai"]);
  });

  it("leaves an unfiled task alone", () => {
    expect(withProjectPrimaryTag(["t-work"], null, tags)).toEqual(["t-work"]);
  });

  it("falls back to any tag of the project when none is flagged primary", () => {
    const noPrimary = [{ id: "t-x", name: "x", projectId: "p-z" }];
    expect(withProjectPrimaryTag([], "p-z", noPrimary)).toEqual(["t-x"]);
  });

  it("adds nothing when the project owns no tags at all", () => {
    expect(withProjectPrimaryTag(["t-work"], "p-none", tags)).toEqual([
      "t-work",
    ]);
  });
});
