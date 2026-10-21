import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import {
  DELETE_ONLY_COLLECTIONS,
  EXPORTED_COLLECTIONS,
} from "@/lib/account-collections";

type Call = { name: string; op: "find" | "deleteMany" | "deleteOne"; filter: Record<string, unknown> };

const state = vi.hoisted(() => ({
  calls: [] as Call[],
  rows: {} as Record<string, Record<string, unknown>[]>,
  decrypted: [] as { name: string; userId: string }[],
}));

vi.mock("@/lib/mongodb", () => ({
  getDb: async () => ({
    collection: (name: string) => ({
      find: (filter: Record<string, unknown>) => {
        state.calls.push({ name, op: "find", filter });
        return { toArray: async () => state.rows[name] ?? [] };
      },
      deleteMany: async (filter: Record<string, unknown>) => {
        state.calls.push({ name, op: "deleteMany", filter });
        return { deletedCount: 1 };
      },
      deleteOne: async (filter: Record<string, unknown>) => {
        state.calls.push({ name, op: "deleteOne", filter });
        return { deletedCount: 1 };
      },
    }),
  }),
}));

vi.mock("@/lib/db/mongo/encrypted", () => ({
  // The three collections this change started exporting are encrypted at rest.
  SPECS: {
    calendarFeeds: { fields: ["label", "url"] },
    externalEvents: { fields: ["title", "location", "notes"] },
    notifications: { fields: ["title", "body", "joinUrl"] },
  },
  decryptAllFor: async (name: string, userId: string, rows: Record<string, unknown>[]) => {
    state.decrypted.push({ name, userId });
    return rows.map((r) => ({ ...r, decrypted: true }));
  },
}));

const { deleteAllUserData, exportUserData } = await import("@/lib/db/mongo/account");

const ME = "6a531654eee9c6861753ffae";

beforeEach(() => {
  state.calls = [];
  state.rows = {};
  state.decrypted = [];
});

describe("deleting an account in Mongo", () => {
  it("clears every collection the account owns, by the string and the ObjectId", async () => {
    await deleteAllUserData(ME);
    for (const name of [...DELETE_ONLY_COLLECTIONS, ...EXPORTED_COLLECTIONS]) {
      const call = state.calls.find((c) => c.name === name && c.op === "deleteMany");
      expect(call, name).toBeDefined();
      const ids = (call!.filter.userId as { $in: unknown[] }).$in;
      expect(ids).toContainEqual(ME);
      expect(ids.some((v) => v instanceof ObjectId && v.toHexString() === ME)).toBe(true);
    }
  });

  it("reaches the collections the old list left behind", async () => {
    await deleteAllUserData(ME);
    const cleared = state.calls.filter((c) => c.op === "deleteMany").map((c) => c.name);
    for (const name of ["calendarFeeds", "externalEvents", "notifications", "pushSubscriptions", "aiUsage", "mcpConfirm"]) {
      expect(cleared, name).toContain(name);
    }
  });

  it("removes sign-in material first and the profile and login last", async () => {
    await deleteAllUserData(ME);
    const order = state.calls.map((c) => c.name);
    expect(order[0]).toBe("session");
    expect(order.indexOf("users")).toBeGreaterThan(order.indexOf("tasks"));
    expect(order.at(-1)).toBe("user");
  });
});

describe("exporting an account from Mongo", () => {
  it("reads the account's records and no credential collection", async () => {
    await exportUserData(ME);
    const read = state.calls.filter((c) => c.op === "find").map((c) => c.name);
    expect(read).toContain("notifications");
    expect(read).toContain("calendarFeeds");
    for (const name of DELETE_ONLY_COLLECTIONS) expect(read).not.toContain(name);
  });

  it("leaves a calendar feed's address out of the file", async () => {
    state.rows.calendarFeeds = [
      { _id: "f1", userId: ME, label: "Work", url: "https://calendar.example.com/private-abc/basic.ics" },
    ];
    const data = await exportUserData(ME);
    const feed = (data.calendarFeeds as Record<string, unknown>[])[0];
    expect(feed.url).toBeUndefined();
    expect(feed.label).toBe("Work");
  });

  it("asks only for this account's rows", async () => {
    await exportUserData(ME);
    for (const call of state.calls.filter((c) => c.op === "find")) {
      expect(call.filter, call.name).toEqual(call.name === "users" ? { _id: ME } : { userId: ME });
    }
  });

  it("decrypts the encrypted collections with the account's own key", async () => {
    state.rows.notifications = [{ _id: "n1", userId: ME, title: "v1:ciphertext" }];
    const data = await exportUserData(ME);
    expect((data.notifications as Record<string, unknown>[])[0].decrypted).toBe(true);
    for (const name of ["calendarFeeds", "externalEvents", "notifications"]) {
      expect(state.decrypted, name).toContainEqual({ name, userId: ME });
    }
  });
});
