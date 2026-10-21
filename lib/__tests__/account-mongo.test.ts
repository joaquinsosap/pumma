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
  SPECS: {},
  decryptAllFor: async (_name: string, _userId: string, rows: unknown[]) => rows,
}));

const { deleteAllUserData, exportUserData } = await import("@/lib/db/mongo/account");

const ME = "6a531654eee9c6861753ffae";

beforeEach(() => {
  state.calls = [];
  state.rows = {};
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
});
