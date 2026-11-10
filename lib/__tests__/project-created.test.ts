// What a new project's toast says, and that it owns up to moving tasks.
import { describe, expect, it } from "vitest";
import { projectCreatedLine } from "@/lib/project-created";

const project = { title: "Website redesign" };

describe("projectCreatedLine", () => {
  it("names the project", () => {
    expect(projectCreatedLine({ project, adopted: null })).toBe('Created "Website redesign"');
  });

  it("says which tag files there now when the project took one over", () => {
    expect(projectCreatedLine({ project, adopted: { tagName: "web", filed: 0 } })).toBe(
      'Created "Website redesign", #web files here now',
    );
  });

  it.each([
    [1, "1 unfiled task moved in"],
    [4, "4 unfiled tasks moved in"],
  ])("owns up to %i moved in", (filed, words) => {
    expect(projectCreatedLine({ project, adopted: { tagName: "web", filed } })).toContain(words);
  });
});
