// The Mongo side of a one-row checklist change: what it asks the database to do, since no server runs in this suite.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";
import { decryptField, isCiphertext, sealField } from "@/lib/crypto/fields";
import { MAX_SUBTASKS, type SubtaskChange } from "@/lib/subtask-changes";

type Write = {
  filter: Record<string, unknown>;
  update: Record<string, Record<string, never>>;
  options: unknown;
};

const state = vi.hoisted(() => ({
  writes: [] as unknown[],
  found: true,
  dek: Buffer.alloc(0),
  // What findOne reads next, oldest first; the last one repeats.
  reads: [] as unknown[][],
  readCount: 0,
  missWrites: 0,
}));

vi.mock("@/lib/mongodb", () => ({
  getDb: async () => ({
    collection: () => ({
      findOne: async () => {
        if (!state.found) return null;
        const subtasks =
          state.reads[Math.min(state.readCount, state.reads.length - 1)];
        state.readCount++;
        return {
          _id: "t1",
          userId: "me",
          title: "Greenhouse",
          description: "",
          subtasks,
          tagIds: [],
          priority: "med",
          status: "todo",
          due: null,
          projectId: null,
          goalId: null,
          lifeArea: "personal",
          order: 0,
          createdAt: "2026-10-01",
          completedAt: null,
          timeSpentSec: 0,
          timerStartedAt: null,
        };
      },
      findOneAndUpdate: async (
        filter: unknown,
        update: unknown,
        options: unknown,
      ) => {
        state.writes.push({ filter, update, options });
        if (state.missWrites > 0) {
          state.missWrites--;
          return null;
        }
        return state.found
          ? {
              _id: "t1",
              userId: "me",
              title: "Greenhouse",
              description: "",
              subtasks: [],
              tagIds: [],
              priority: "med",
              status: "todo",
              due: null,
              projectId: null,
              goalId: null,
              lifeArea: "personal",
              order: 0,
              createdAt: "2026-10-01",
              completedAt: null,
              timeSpentSec: 0,
              timerStartedAt: null,
            }
          : null;
      },
    }),
  }),
}));
vi.mock("@/lib/crypto/user-key", () => ({
  getUserDek: async () => state.dek,
}));

const { changeSubtask, rewriteSubtasks } = await import("@/lib/db/mongo/tasks");

const write = async (change: SubtaskChange) => {
  await changeSubtask("me", "t1", change);
  return state.writes.at(-1) as Write;
};

beforeEach(() => {
  state.writes.length = 0;
  state.found = true;
  state.dek = randomBytes(32);
  state.reads = [];
  state.readCount = 0;
  state.missWrites = 0;
});

describe("changeSubtask on Mongo", () => {
  it("is scoped to the task and its owner on every kind of change", async () => {
    for (const change of [
      { kind: "add", id: "n", title: "x" },
      { kind: "setDone", id: "s", done: true },
      { kind: "rename", id: "s", title: "x" },
      { kind: "remove", id: "s" },
    ] as SubtaskChange[]) {
      const { filter } = await write(change);
      expect(filter._id, change.kind).toBe("t1");
      expect(filter.userId, change.kind).toBe("me");
    }
  });

  it("asks for the list after the change, which is what the action answers with", async () => {
    const { options } = await write({ kind: "remove", id: "s" });
    expect(options).toEqual({ returnDocument: "after" });
  });

  it("adds with a push guarded against a repeat id and a full list", async () => {
    const { filter, update } = await write({
      kind: "add",
      id: "n",
      title: "A private title",
    });
    expect(filter["subtasks.id"]).toEqual({ $ne: "n" });
    expect(filter[`subtasks.${MAX_SUBTASKS - 1}`]).toEqual({ $exists: false });
    const row = update.$push.subtasks as unknown as {
      id: string;
      title: string;
      done: boolean;
    };
    expect(row.id).toBe("n");
    expect(row.done).toBe(false);
    expect(isCiphertext(row.title)).toBe(true);
    expect(decryptField(row.title, state.dek)).toBe("A private title");
  });

  it("ticks one row by position, leaving its title out of the write", async () => {
    const { filter, update } = await write({
      kind: "setDone",
      id: "s",
      done: true,
    });
    expect(filter["subtasks.id"]).toBe("s");
    expect(update).toEqual({ $set: { "subtasks.$.done": true } });
  });

  it("renames one row by position, with the title sealed", async () => {
    const { filter, update } = await write({
      kind: "rename",
      id: "s",
      title: "v1: ship it",
    });
    expect(filter["subtasks.id"]).toBe("s");
    const sealed = update.$set["subtasks.$.title"] as unknown as string;
    expect(isCiphertext(sealed)).toBe(true);
    expect(decryptField(sealed, state.dek)).toBe("v1: ship it");
  });

  it("removes by id, matching the task whether or not the row is still there", async () => {
    const { filter, update } = await write({ kind: "remove", id: "s" });
    expect(filter).not.toHaveProperty("subtasks.id");
    expect(update).toEqual({ $pull: { subtasks: { id: "s" } } });
  });

  it("answers null when nothing matched", async () => {
    state.found = false;
    expect(
      await changeSubtask("me", "t1", { kind: "remove", id: "s" }),
    ).toBeNull();
  });
});

describe("rewriteSubtasks on Mongo", () => {
  const stored = (title: string, done = false) => ({
    id: title,
    title: sealField(title, state.dek),
    done,
  });
  const tickAll = (list: { id: string; title: string; done: boolean }[]) =>
    list.map((s) => ({ ...s, done: true }));

  it("only writes over the exact list it read, for this task and owner", async () => {
    const list = [stored("Water"), stored("Weed")];
    state.reads = [list];
    await rewriteSubtasks("me", "t1", tickAll);
    const { filter, options } = state.writes.at(-1) as Write;
    expect(filter).toEqual({ _id: "t1", userId: "me", subtasks: list });
    expect(options).toEqual({ returnDocument: "after" });
  });

  it("builds from decrypted titles and stores them sealed", async () => {
    state.reads = [[stored("A private title")]];
    const seen: string[] = [];
    await rewriteSubtasks("me", "t1", (list) => {
      seen.push(...list.map((s) => s.title));
      return tickAll(list);
    });
    expect(seen).toEqual(["A private title"]);
    const { update } = state.writes.at(-1) as Write;
    const [row] = update.$set.subtasks as unknown as { title: string }[];
    expect(isCiphertext(row.title)).toBe(true);
    expect(decryptField(row.title, state.dek)).toBe("A private title");
  });

  it("reads again and rebuilds when the list changed before the write", async () => {
    const first = [stored("Water")];
    const second = [stored("Water"), stored("Added in the app")];
    state.reads = [first, second];
    state.missWrites = 1;
    const builds: number[] = [];
    await rewriteSubtasks("me", "t1", (list) => {
      builds.push(list.length);
      return tickAll(list);
    });
    expect(builds).toEqual([1, 2]);
    const [miss, hit] = state.writes as Write[];
    expect(miss.filter.subtasks).toBe(first);
    expect(hit.filter.subtasks).toBe(second);
    expect(hit.update.$set.subtasks).toHaveLength(2);
  });

  it("gives up with an error, not a loop, when it never gets a clean write", async () => {
    state.reads = [[stored("Water")]];
    state.missWrites = 99;
    await expect(rewriteSubtasks("me", "t1", tickAll)).rejects.toThrow(
      "kept changing",
    );
    expect(state.writes).toHaveLength(5);
  });

  it("writes nothing when the list comes out the same", async () => {
    state.reads = [[stored("Water", true)]];
    const task = await rewriteSubtasks("me", "t1", tickAll);
    expect(state.writes).toHaveLength(0);
    expect(task?.subtasks).toEqual([{ id: "Water", title: "Water", done: true }]);
  });

  it("writes nothing when building refuses", async () => {
    state.reads = [[stored("Water")]];
    await expect(
      rewriteSubtasks("me", "t1", () => {
        throw new Error("no permission");
      }),
    ).rejects.toThrow("no permission");
    expect(state.writes).toHaveLength(0);
  });

  it("answers null when the task is gone", async () => {
    state.found = false;
    expect(await rewriteSubtasks("me", "t1", tickAll)).toBeNull();
    expect(state.writes).toHaveLength(0);
  });
});
