// The Mongo side of "a new project goes first": what it asks the database, since no server runs in this suite.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  // Rows as stored: the old ones carry no `order` at all.
  rows: [] as { _id: string; userId: string; order?: number }[],
  finds: [] as Record<string, unknown>[],
  inserted: [] as { order: number }[],
}));

vi.mock("@/lib/db/mongo/encrypted", () => ({
  encryptFor: async (_c: string, _u: string, doc: unknown) => doc,
  decryptFor: async (_c: string, _u: string, doc: unknown) => doc,
  decryptAllFor: async (_c: string, _u: string, docs: unknown) => docs,
}));

vi.mock("@/lib/mongodb", () => ({
  getDb: async () => ({
    collection: () => ({
      // Enough of a cursor to answer the one read insertProject makes, the way Mongo would.
      find: (filter: Record<string, unknown>) => {
        state.finds.push(filter);
        const wantsOrder = Boolean(
          (filter.order as { $exists?: boolean } | undefined)?.$exists,
        );
        let hits = state.rows.filter(
          (r) =>
            r.userId === filter.userId &&
            (!wantsOrder || r.order !== undefined),
        );
        const cursor = {
          sort: () => {
            // A missing field sorts lowest in Mongo.
            hits = [...hits].sort(
              (a, b) => (a.order ?? -Infinity) - (b.order ?? -Infinity),
            );
            return cursor;
          },
          limit: () => cursor,
          next: async () => hits[0] ?? null,
        };
        return cursor;
      },
      insertOne: async (doc: { _id: string; userId: string; order: number }) => {
        state.inserted.push(doc);
        state.rows.push(doc);
      },
    }),
  }),
}));

import { insertProject } from "@/lib/db/mongo/projects";

const make = (title: string) =>
  insertProject({
    userId: "me",
    title,
    description: "",
    color: "oklch(0.6 0.13 155)",
    progress: 0,
    label: "0/0",
    goalId: null,
    tagIds: [],
    lifeArea: "personal",
    createdAt: "2026-11-10",
  });

describe("insertProject on Mongo", () => {
  beforeEach(() => {
    state.rows = [];
    state.finds = [];
    state.inserted = [];
  });

  it("puts each new project ahead of the last, on an account whose old projects were never ordered", async () => {
    state.rows = [
      { _id: "old1", userId: "me" },
      { _id: "old2", userId: "me" },
    ];
    const a = await make("A");
    const b = await make("B");
    const c = await make("C");
    // Not three projects tied at -1 behind a row with no order.
    expect([a.order, b.order, c.order]).toEqual([-1, -2, -3]);
  });

  it("goes below the lowest order a drag has written", async () => {
    state.rows = [
      { _id: "p1", userId: "me", order: 0 },
      { _id: "p2", userId: "me", order: 1 },
      { _id: "theirs", userId: "someone-else", order: -40 },
    ];
    expect((await make("New")).order).toBe(-1);
    expect(state.finds[0].userId).toBe("me");
  });

  it("keeps an order it was handed, which is how an undo puts a project back", async () => {
    const restored = await insertProject({
      userId: "me",
      title: "Back",
      description: "",
      color: "oklch(0.6 0.13 155)",
      progress: 0,
      label: "0/0",
      goalId: null,
      tagIds: [],
      lifeArea: "personal",
      createdAt: "2026-11-10",
      order: 7,
      updatedAt: "2026-11-01T00:00:00.000Z",
    });
    expect(restored.order).toBe(7);
    expect(restored.updatedAt).toBe("2026-11-01T00:00:00.000Z");
    expect(state.finds).toHaveLength(0);
  });
});
