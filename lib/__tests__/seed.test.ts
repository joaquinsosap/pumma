import { describe, expect, it } from "vitest";
import { createSeedData } from "@/lib/seed";

describe("the seed", () => {
  const seed = createSeedData("seed-user");

  it("files every project task under its project's flagship tag", () => {
    const projectTasks = seed.tasks.filter((t) => t.projectId);
    expect(projectTasks.length).toBeGreaterThan(0);
    for (const task of projectTasks) {
      const flagship = seed.tags.find(
        (t) => t.projectId === task.projectId && t.isProjectPrimary,
      )!;
      expect(task.tagIds, task.title).toContain(flagship._id);
    }
  });

  it("only uses tags it plants", () => {
    const planted = new Set(seed.tags.map((t) => t._id));
    for (const task of seed.tasks) {
      for (const id of task.tagIds) expect(planted.has(id), task.title).toBe(true);
    }
  });
});
