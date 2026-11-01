// The SAMPLE_DATA switch on a real first login, against the memory store.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapNewUser } from "@/lib/auth/bootstrap";
import { getStore, resetStore } from "@/lib/store/memory";

const userId = "sample-user";

describe("a new account with sample data", () => {
  beforeEach(async () => {
    resetStore();
    process.env.SAMPLE_DATA = "1";
    await bootstrapNewUser({ id: userId, name: "Sam" });
  });

  afterEach(() => {
    delete process.env.SAMPLE_DATA;
  });

  const mine = <T extends { userId: string }>(rows: T[]) =>
    rows.filter((row) => row.userId === userId);

  it("plants the tags its records point at, under this account's own ids", () => {
    const store = getStore();
    const planted = new Set(mine(store.tags).map((t) => t._id));
    for (const rows of [store.tasks, store.habits, store.goals, store.notes, store.projects]) {
      for (const row of mine<{ userId: string; tagIds: string[] }>(rows)) {
        for (const id of row.tagIds) expect(planted.has(id)).toBe(true);
      }
    }
    expect(mine(store.tasks).some((t) => t.tagIds.length > 0)).toBe(true);
  });

  it("reuses the life tags the account already has instead of doubling them", () => {
    const names = mine(getStore().tags).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("personal");
    expect(names).toContain("work");
  });

  it("files every project task under its project's flagship tag", () => {
    const store = getStore();
    const projectTasks = mine(store.tasks).filter((t) => t.projectId);
    expect(projectTasks.length).toBeGreaterThan(0);
    for (const task of projectTasks) {
      const flagship = mine(store.tags).find(
        (t) => t.projectId === task.projectId && t.isProjectPrimary,
      )!;
      expect(task.tagIds, task.title).toContain(flagship._id);
    }
  });
});
