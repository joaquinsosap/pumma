import { describe, it, expect, beforeEach } from "vitest";
import { exportUserData, deleteAllUserData } from "@/lib/db/memory/account";
import { getStore, resetStore } from "@/lib/store/memory";
import { NEVER_EXPORT } from "@/lib/export-redaction";
import {
  calendarFeedSchema,
  externalEventSchema,
  notificationSchema,
  pushSubscriptionSchema,
} from "@/lib/schemas";

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

describe("what an export must never carry", () => {
  beforeEach(() => resetStore());

  it("strips the account's key material from the profile row", async () => {
    // dekWrapped is this user's data key sealed by the master key, stored on
    // their own profile row. It cannot be opened without the master key — but
    // shipping it means one master-key leak retroactively opens every export
    // anyone ever downloaded, and it is useless to the person exporting.
    const store = getStore();
    const me = store.users[0]._id;
    Object.assign(store.users[0], {
      dekWrapped: "wrapped-key-material",
      dekKeyId: "key-1",
    });

    const data = await exportUserData(me);
    const profile = data.profile as Record<string, unknown>[];
    expect(profile).toHaveLength(1);
    expect(profile[0].dekWrapped).toBeUndefined();
    expect(profile[0].dekKeyId).toBeUndefined();
    // The rest of the profile survives — this is a redaction, not a blanking.
    expect(profile[0]._id).toBe(me);
  });

  it("strips the stored AI key from settings", async () => {
    const store = getStore();
    const me = store.users[0]._id;
    const mine = store.settings.find((s) => s.userId === me);
    if (mine) Object.assign(mine, { aiApiKeyEnc: "enc:secret" });

    const data = await exportUserData(me);
    for (const row of data.settings as Record<string, unknown>[]) {
      expect(row.aiApiKeyEnc).toBeUndefined();
    }
  });

  it("carries no field from the never-export list, in any collection", async () => {
    const store = getStore();
    const me = store.users[0]._id;
    const data = await exportUserData(me);
    for (const [collection, rows] of Object.entries(data)) {
      for (const row of rows as Record<string, unknown>[]) {
        for (const field of NEVER_EXPORT) {
          expect({ collection, field, present: field in (row ?? {}) }).toEqual({
            collection,
            field,
            present: false,
          });
        }
      }
    }
  });
});

describe("account deletion reaches the newer collections", () => {
  beforeEach(() => resetStore());

  function seedNewer(userId: string, tag: string) {
    const store = getStore();
    const now = "2026-10-21T12:00:00.000Z";
    store.calendarFeeds.push(
      calendarFeedSchema.parse({ _id: `feed-${tag}`, userId, url: `https://cal.example.com/${tag}.ics`, createdAt: now }),
    );
    store.externalEvents.push(
      externalEventSchema.parse({ _id: `ev-${tag}`, userId, feedId: `feed-${tag}`, key: `k-${tag}`, title: "Standup", date: "2026-10-22" }),
    );
    store.notifications.push(
      notificationSchema.parse({ _id: `n-${tag}`, userId, kind: "task", fireAt: now, createdAt: now, url: "/tasks?task=t1" }),
    );
    store.pushSubscriptions.push(
      pushSubscriptionSchema.parse({ _id: `p-${tag}`, userId, endpoint: `https://push.example.com/${tag}`, p256dh: "key", auth: "secret", createdAt: now, lastSeenAt: now }),
    );
  }

  it("leaves no row of the account anywhere in the store", async () => {
    const store = getStore();
    const me = store.users[0]._id;
    seedNewer(me, "mine");
    seedNewer(OTHER, "theirs");

    await deleteAllUserData(me);

    for (const [name, rows] of Object.entries(store)) {
      if (!Array.isArray(rows)) continue;
      const mine = (rows as { userId?: string }[]).filter((r) => r.userId === me);
      expect({ name, left: mine.length }).toEqual({ name, left: 0 });
    }
    expect(store.calendarFeeds.map((f) => f.userId)).toEqual([OTHER]);
    expect(store.pushSubscriptions.map((p) => p.userId)).toEqual([OTHER]);
  });

  it("exports calendars and reminders, without the feed address or push keys", async () => {
    const store = getStore();
    const me = store.users[0]._id;
    seedNewer(me, "mine");

    const data = await exportUserData(me);
    const ids = (rows: unknown[]) => (rows as { _id: string }[]).map((r) => r._id);
    expect(ids(data.notifications)).toContain("n-mine");
    expect(ids(data.externalEvents)).toContain("ev-mine");
    const feed = (data.calendarFeeds as Record<string, unknown>[]).find((f) => f._id === "feed-mine");
    expect(feed).toBeDefined();
    expect(feed!.url).toBeUndefined();
    // Only the feed's url is secret; a reminder's url is an in-app path and stays.
    const reminder = (data.notifications as Record<string, unknown>[]).find((n) => n._id === "n-mine");
    expect(reminder!.url).toBe("/tasks?task=t1");
    expect(data).not.toHaveProperty("pushSubscriptions");
  });
});
