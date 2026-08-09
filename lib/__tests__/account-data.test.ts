import { describe, it, expect, beforeEach } from "vitest";
import { exportUserData, deleteAllUserData } from "@/lib/db/memory/account";
import { getStore, resetStore } from "@/lib/store/memory";

const OTHER = "someone-else";

/** Give a second account rows in every collection the seed user has. */
function seedOtherUser() {
  const store = getStore();
  store.tasks.push({
    ...structuredClone(store.tasks[0]),
    _id: "other-task",
    userId: OTHER,
  });
  store.notes.push({
    ...structuredClone(store.notes[0]),
    _id: "other-note",
    userId: OTHER,
  });
  store.goals.push({
    ...structuredClone(store.goals[0]),
    _id: "other-goal",
    userId: OTHER,
  });
  store.users.push({
    ...structuredClone(store.users[0]),
    _id: OTHER,
  });
}

describe("account export", () => {
  beforeEach(() => resetStore());

  it("returns only the asking user's rows", () => {
    seedOtherUser();
    const store = getStore();
    const mine = exportUserData(store.users[0]._id);
    return mine.then((data) => {
      const ids = (data.tasks as { userId: string }[]).map((t) => t.userId);
      expect(new Set(ids)).toEqual(new Set([store.users[0]._id]));
      expect(data.tasks.length).toBeGreaterThan(0);
    });
  });

  it("covers every collection the store holds", async () => {
    const store = getStore();
    const data = await exportUserData(store.users[0]._id);
    for (const key of [
      "tasks",
      "notes",
      "habits",
      "habitEntries",
      "goals",
      "projects",
      "agenda",
      "tags",
      "settings",
      "lifeDays",
      "lifeWeeks",
      "profile",
    ]) {
      expect(data, `missing ${key}`).toHaveProperty(key);
    }
  });
});

describe("account deletion", () => {
  beforeEach(() => resetStore());

  it("removes everything belonging to the user", async () => {
    const store = getStore();
    const userId = store.users[0]._id;
    await deleteAllUserData(userId);

    const left = await exportUserData(userId);
    const total = Object.values(left).reduce(
      (sum, rows) => sum + rows.length,
      0,
    );
    expect(total).toBe(0);
    expect(store.users.some((u) => u._id === userId)).toBe(false);
  });

  it("leaves other accounts untouched", async () => {
    seedOtherUser();
    const store = getStore();
    const userId = store.users[0]._id;

    await deleteAllUserData(userId);

    // The whole point: one account closing must not take another with it.
    expect(store.tasks.map((t) => t.userId)).toEqual([OTHER]);
    expect(store.notes.map((n) => n.userId)).toEqual([OTHER]);
    expect(store.goals.map((g) => g.userId)).toEqual([OTHER]);
    expect(store.users.map((u) => u._id)).toEqual([OTHER]);

    const theirs = await exportUserData(OTHER);
    expect(theirs.tasks).toHaveLength(1);
  });

  it("is safe to run twice", async () => {
    const store = getStore();
    const userId = store.users[0]._id;
    await deleteAllUserData(userId);
    const second = await deleteAllUserData(userId);
    expect(Object.values(second).every((n) => n === 0)).toBe(true);
  });
});
