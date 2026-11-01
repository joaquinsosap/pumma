// Subtasks through the MCP: the pure list rules, then the real tool handlers against the memory store.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Subtask } from "@/lib/schemas";
import type { McpCaller } from "@/lib/mcp/context";
import { MCP_SCOPE } from "@/lib/mcp/config";
import { McpPolicyError, McpScopeError } from "@/lib/mcp/policy";
import { runTool } from "@/lib/mcp/registry";
import { toolInput } from "@/lib/mcp/schema";
import { getCurrentUserId, getStore, resetStore } from "@/lib/store/memory";
import { updateGoal as goalWrite } from "@/lib/db/goals";
import { listMcpAudit } from "@/lib/db/memory/mcp-audit";
import { insertGoal, updateGoal } from "@/lib/db/memory/goals";
import { insertProject } from "@/lib/db/memory/projects";
import { getSettings } from "@/lib/db/memory/settings";
import { insertTask } from "@/lib/db/memory/tasks";
import {
  insertTask as insertRow,
  rewriteSubtasks as rewriteRow,
  updateTask as updateRow,
} from "@/lib/db/tasks";
import {
  sameSubtasks,
  subtaskChanges,
  subtasksFromInput,
  tickedSubtasks,
} from "@/lib/mcp/subtasks";
import { completeTask, createTask, updateTask } from "@/lib/mcp/tools/write";

// Pass-through wrappers at the repository seam, to count writes and make one fail.
vi.mock("@/lib/db/tasks", async (actual) => {
  const real = await actual<typeof import("@/lib/db/tasks")>();
  return {
    ...real,
    insertTask: vi.fn(real.insertTask),
    updateTask: vi.fn(real.updateTask),
    rewriteSubtasks: vi.fn(real.rewriteSubtasks),
  };
});
vi.mock("@/lib/db/goals", async (actual) => {
  const real = await actual<typeof import("@/lib/db/goals")>();
  return { ...real, updateGoal: vi.fn(real.updateGoal) };
});

const a: Subtask = { id: "a", title: "Water", done: true };
const b: Subtask = { id: "b", title: "Weed", done: false };

function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

describe("subtasksFromInput", () => {
  it("gives a new title a fresh id and leaves it not done", () => {
    expect(subtasksFromInput([{ title: "Plant" }], [], counter())).toEqual([
      { id: "new-1", title: "Plant", done: false },
    ]);
  });

  it("keeps the id and the tick of a title already on the task", () => {
    expect(
      subtasksFromInput([{ title: "Water" }, { title: "Weed" }], [a, b]),
    ).toEqual([a, b]);
  });

  it("lets done override the tick, either way", () => {
    expect(
      subtasksFromInput(
        [
          { title: "Water", done: false },
          { title: "Weed", done: true },
        ],
        [a, b],
      ),
    ).toEqual([
      { ...a, done: false },
      { ...b, done: true },
    ]);
  });

  it("follows the order sent, and adds to what it keeps", () => {
    expect(
      subtasksFromInput(
        [{ title: "Plant" }, { title: "Water" }],
        [a, b],
        counter(),
      ),
    ).toEqual([{ id: "new-1", title: "Plant", done: false }, a]);
  });

  it("keeps two subtasks with one title as two rows", () => {
    const first = { id: "x", title: "Same", done: true };
    const second = { id: "y", title: "Same", done: false };
    expect(
      subtasksFromInput(
        [{ title: "Same" }, { title: "Same" }, { title: "Same" }],
        [first, second],
        counter(),
      ),
    ).toEqual([first, second, { id: "new-1", title: "Same", done: false }]);
  });

  it("keeps the tick through small differences in a title", () => {
    for (const title of ["Water ", " Water", "water", "WATER"]) {
      expect(subtasksFromInput([{ title }], [a], counter())).toEqual([
        { ...a, title },
      ]);
    }
    const nfc = { id: "c", title: "Café", done: true };
    const nfd = "Café";
    expect(subtasksFromInput([{ title: nfd }], [nfc], counter())).toEqual([
      { ...nfc, title: nfd },
    ]);
  });

  it("lets an exact title claim its row before a near match can", () => {
    const lower = { id: "l", title: "water", done: false };
    const upper = { id: "u", title: "Water", done: true };
    expect(
      subtasksFromInput(
        [{ title: "WATER" }, { title: "Water" }, { title: "water" }],
        [lower, upper],
        counter(),
      ),
    ).toEqual([{ id: "new-1", title: "WATER", done: false }, upper, lower]);
  });

  it("treats a different title as new", () => {
    expect(subtasksFromInput([{ title: "Watering" }], [a], counter())).toEqual([
      { id: "new-1", title: "Watering", done: false },
    ]);
  });

  it("clears the list when sent an empty one", () => {
    expect(subtasksFromInput([], [a, b])).toEqual([]);
  });
});

describe("tickedSubtasks", () => {
  it("ticks every box", () => {
    expect(tickedSubtasks([a, b])).toEqual([a, { ...b, done: true }]);
    expect(tickedSubtasks([])).toEqual([]);
  });
});

describe("sameSubtasks", () => {
  it("notices a different tick, title, id, order or length", () => {
    expect(sameSubtasks([a, b], [{ ...a }, { ...b }])).toBe(true);
    expect(sameSubtasks([a, b], [a, { ...b, done: true }])).toBe(false);
    expect(sameSubtasks([a, b], [a, { ...b, title: "Hoe" }])).toBe(false);
    expect(sameSubtasks([a, b], [a, { ...b, id: "z" }])).toBe(false);
    expect(sameSubtasks([a, b], [b, a])).toBe(false);
    expect(sameSubtasks([a, b], [a])).toBe(false);
  });
});

describe("subtaskChanges", () => {
  it("counts rows added and dropped by id, not by title or tick", () => {
    expect(subtaskChanges([a, b], [a, b])).toEqual({ added: 0, removed: 0 });
    expect(subtaskChanges([a, b], [{ ...a, title: "x", done: false }, b])).toEqual(
      { added: 0, removed: 0 },
    );
    expect(subtaskChanges([a], [a, b])).toEqual({ added: 1, removed: 0 });
    expect(subtaskChanges([a, b], [b])).toEqual({ added: 0, removed: 1 });
    expect(subtaskChanges([a, b], [])).toEqual({ added: 0, removed: 2 });
    expect(subtaskChanges([a, b], [a, { ...b, id: "c" }])).toEqual({
      added: 1,
      removed: 1,
    });
  });

  it("sees a dropped row even when two rows share an id", () => {
    const twin = { ...a, title: "Twin" };
    expect(subtaskChanges([a, twin], [a])).toEqual({ added: 0, removed: 1 });
    expect(subtaskChanges([a, twin], [a, twin])).toEqual({ added: 0, removed: 0 });
  });
});

describe("the MCP task tools", () => {
  const userId = getCurrentUserId();

  async function callerWith(allowDelete: boolean): Promise<McpCaller> {
    const settings = (await getSettings(userId))!;
    return {
      userId,
      clientId: "test-client",
      scopes: new Set([MCP_SCOPE.read, MCP_SCOPE.write, MCP_SCOPE.delete]),
      settings: { ...settings, mcp: { ...settings.mcp, enabled: true, allowDelete } },
      timeZone: "UTC",
    };
  }

  type Outcome = { ok: boolean; id?: string; changed?: string[] };
  const data = (out: { data?: unknown }) => out.data as Outcome;
  const stored = (id: string) => getStore().tasks.find((t) => t._id === id)!;
  const allDone = (id: string) => stored(id).subtasks.every((s) => s.done);

  // Through the schema, as the server does, so trimming and limits apply.
  const update = async (input: unknown, caller?: McpCaller) =>
    updateTask.handler(
      updateTask.inputSchema.parse(input),
      caller ?? (await callerWith(false)),
    );
  const complete = async (id: string, tickSubtasks?: boolean) =>
    completeTask.handler({ id, tickSubtasks }, await callerWith(false));

  function seed(
    subtasks: Subtask[],
    closed?: { completedAt: string | null },
    projectId: string | null = null,
  ): Promise<{ id: string }> {
    return insertTask({
      userId,
      title: "Greenhouse",
      description: "",
      subtasks,
      tagIds: [],
      priority: "med",
      status: closed ? "done" : "todo",
      due: null,
      projectId,
      goalId: null,
      lifeArea: "personal",
      order: 0,
      createdAt: "2026-10-01",
      completedAt: closed ? closed.completedAt : null,
    });
  }

  /** A goal over a project with two open tasks, so closing one means 50%. */
  async function goalOverProject() {
    const goal = await insertGoal({
      userId,
      title: "G",
      category: "personal",
      metricLabel: "",
      progress: 0,
      targetDate: null,
      tagIds: [],
      lifeArea: "personal",
      order: 0,
      createdAt: "2026-10-01",
    });
    const project = await insertProject({
      userId,
      title: "P",
      description: "",
      color: "oklch(0.6 0.13 155)",
      progress: 0,
      label: "0/2",
      goalId: goal.id,
      tagIds: [],
      lifeArea: "personal",
      createdAt: "2026-10-01",
    });
    const one = await seed([], undefined, project.id);
    await seed([], undefined, project.id);
    const progress = () =>
      getStore().goals.find((g) => g._id === goal.id)!.progress;
    return { goal, one, progress };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  describe("create_task", () => {
    it("stores the checklist with the task", async () => {
      const out = await createTask.handler(
        createTask.inputSchema.parse({
          title: "Greenhouse",
          subtasks: [{ title: " Water ", done: true }, { title: "Weed" }],
        }),
        await callerWith(false),
      );
      expect(data(out).ok).toBe(true);
      const list = stored(data(out).id!).subtasks;
      expect(list.map((s) => [s.title, s.done])).toEqual([
        ["Water", true],
        ["Weed", false],
      ]);
      expect(list[0].id).not.toBe(list[1].id);
      expect(list[0].id.length).toBeGreaterThan(0);
    });

    it("leaves the list empty when none is sent", async () => {
      const out = await createTask.handler(
        createTask.inputSchema.parse({ title: "Greenhouse" }),
        await callerWith(false),
      );
      expect(stored(data(out).id!).subtasks).toEqual([]);
    });

    it("is one insert with no second write, so it can't half happen", async () => {
      await createTask.handler(
        createTask.inputSchema.parse({
          title: "Greenhouse",
          subtasks: [{ title: "Water" }],
        }),
        await callerWith(false),
      );
      expect(insertRow).toHaveBeenCalledTimes(1);
      expect(updateRow).not.toHaveBeenCalled();
    });

    it("still gives the id when the goal above fails, so a retry can't duplicate", async () => {
      const { one } = await goalOverProject();
      const rows = getStore().tasks.length;
      vi.mocked(goalWrite).mockRejectedValueOnce(new Error("goal write failed"));
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const out = await createTask.handler(
        createTask.inputSchema.parse({
          title: "Barn",
          projectId: stored(one.id).projectId,
          subtasks: [{ title: "Water" }],
        }),
        await callerWith(false),
      );
      expect(goalWrite).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledOnce();
      logged.mockRestore();
      expect(out.data).toMatchObject({ ok: true, goalSynced: false });
      expect(out.entityIds).toEqual([data(out).id]);
      expect(out.text).toContain("Do not create this task again");
      expect(getStore().tasks).toHaveLength(rows + 1);
      expect(stored(data(out).id!).subtasks[0].title).toBe("Water");
    });

    it("says nothing about a goal when the update goes through", async () => {
      const { one } = await goalOverProject();
      const out = await createTask.handler(
        createTask.inputSchema.parse({
          title: "Barn",
          projectId: stored(one.id).projectId,
        }),
        await callerWith(false),
      );
      expect(out.text).not.toContain("goal");
      expect(out.data).not.toHaveProperty("goalSynced");
      expect(out.entityIds).toEqual([data(out).id]);
    });
  });

  describe("update_task, deleting off", () => {
    it("adds to the list, says how many, and touches nothing else", async () => {
      const { id } = await seed([a, b]);
      const out = await update({
        id,
        subtasks: [{ title: "Water" }, { title: "Weed" }, { title: "Plant" }],
      });
      expect(data(out)).toEqual({ ok: true, id, changed: ["subtasks"] });
      expect(out.text).toContain("subtasks (1 added, 0 removed)");
      const row = stored(id);
      expect(row.subtasks.slice(0, 2)).toEqual([a, b]);
      expect(row.subtasks[2].title).toBe("Plant");
      expect(row.status).toBe("todo");
      expect(row.title).toBe("Greenhouse");
    });

    it("can reorder and tick, since nothing goes", async () => {
      const { id } = await seed([a, b]);
      await update({
        id,
        subtasks: [{ title: "Weed", done: true }, { title: "Water" }],
      });
      expect(stored(id).subtasks).toEqual([{ ...b, done: true }, a]);
    });

    it("keeps the row through a small difference in the title", async () => {
      const { id } = await seed([a, b]);
      await update({
        id,
        subtasks: [{ title: "water " }, { title: "Weed" }],
      });
      expect(stored(id).subtasks).toEqual([{ ...a, title: "water" }, b]);
    });

    it("refuses a list that would remove a row, and writes nothing", async () => {
      const { id } = await seed([a, b]);
      const before = stored(id).subtasks;
      await expect(
        update({ id, title: "Barn", status: "done", subtasks: [{ title: "Water" }] }),
      ).rejects.toBeInstanceOf(McpPolicyError);
      expect(stored(id).subtasks).toBe(before);
      expect(stored(id).title).toBe("Greenhouse");
      expect(stored(id).status).toBe("todo");
    });

    it("refuses an empty list", async () => {
      const { id } = await seed([a, b]);
      await expect(update({ id, subtasks: [] })).rejects.toBeInstanceOf(
        McpPolicyError,
      );
      expect(stored(id).subtasks).toEqual([a, b]);
    });

    it("refuses a model adding one item by sending only that item", async () => {
      const { id } = await seed([a, b]);
      await expect(
        update({ id, subtasks: [{ title: "Plant" }] }),
      ).rejects.toBeInstanceOf(McpPolicyError);
      expect(stored(id).subtasks).toEqual([a, b]);
    });

    it("refuses dropping one of two rows that share an id", async () => {
      const { id } = await seed([a, { ...a, title: "Twin" }]);
      await expect(
        update({ id, subtasks: [{ title: "Water" }] }),
      ).rejects.toBeInstanceOf(McpPolicyError);
      expect(stored(id).subtasks).toHaveLength(2);
    });

    it("answers through the tool wrapper with how to keep them", async () => {
      const { id } = await seed([a, b]);
      const result = await runTool(
        updateTask,
        await callerWith(false),
      )(updateTask.inputSchema.parse({ id, subtasks: [{ title: "Plant" }] }));
      expect("isError" in result && result.isError).toBe(true);
      const text = result.content[0].text;
      expect(text).toContain("leaves out 2 subtasks");
      expect(text).toContain("delete them");
      expect(text).toContain("send the whole list");
      expect(text).toContain("renaming one deletes the old one");
      expect(text).toContain("account owner");
      expect(text).not.toContain("Do not retry");
      const [audit] = await listMcpAudit(userId, 1);
      expect(audit.errorCode).toBe("policy_denied");
    });

    it("counts one row in the singular", async () => {
      const { id } = await seed([a, b]);
      const short = update({ id, subtasks: [{ title: "Water" }] });
      await expect(short).rejects.toThrow(/leaves out 1 subtask already/);
      await expect(short).rejects.toThrow(/delete it\./);
    });
  });

  describe("update_task, deleting on", () => {
    it("removes rows and says how many", async () => {
      const { id } = await seed([a, b]);
      const out = await update(
        { id, subtasks: [{ title: "Water" }, { title: "Plant" }] },
        await callerWith(true),
      );
      expect(out.text).toContain("subtasks (1 added, 1 removed)");
      expect(stored(id).subtasks[0]).toEqual(a);
      expect(stored(id).subtasks[1].title).toBe("Plant");
      expect(stored(id).subtasks).toHaveLength(2);
    });

    it("clears the list when sent an empty one", async () => {
      const { id } = await seed([a, b]);
      await update({ id, subtasks: [] }, await callerWith(true));
      expect(stored(id).subtasks).toEqual([]);
    });

    it("still needs the connection to hold the delete scope", async () => {
      const { id } = await seed([a, b]);
      const caller = await callerWith(true);
      const short = update(
        { id, subtasks: [] },
        { ...caller, scopes: new Set([MCP_SCOPE.write]) },
      );
      await expect(short).rejects.toBeInstanceOf(McpScopeError);
      expect(stored(id).subtasks).toEqual([a, b]);
    });

    it("says how to keep them when the delete scope is missing, and audits it as that", async () => {
      const { id } = await seed([a, b]);
      const caller = await callerWith(true);
      const result = await runTool(updateTask, {
        ...caller,
        scopes: new Set([MCP_SCOPE.write]),
      })(updateTask.inputSchema.parse({ id, subtasks: [] }));
      expect("isError" in result && result.isError).toBe(true);
      const text = result.content[0].text;
      expect(text).toContain("send the whole list");
      expect(text).toContain("reconnected with the delete permission");
      const [audit] = await listMcpAudit(userId, 1);
      expect(audit.errorCode).toBe("insufficient_scope");
    });
  });

  describe("a connection with no delete permission", () => {
    const writeOnly = async (): Promise<McpCaller> => ({
      ...(await callerWith(false)),
      scopes: new Set([MCP_SCOPE.read, MCP_SCOPE.write]),
    });

    it("can add, reorder and tick, since nothing goes", async () => {
      const { id } = await seed([a, b]);
      await update(
        {
          id,
          subtasks: [
            { title: "Plant" },
            { title: "Weed", done: true },
            { title: "Water" },
          ],
        },
        await writeOnly(),
      );
      expect(stored(id).subtasks.map((s) => [s.title, s.done])).toEqual([
        ["Plant", false],
        ["Weed", true],
        ["Water", true],
      ]);
    });

    it("can close a task and tick its boxes, since that removes nothing", async () => {
      const { id } = await seed([a, b]);
      await completeTask.handler({ id, tickSubtasks: true }, await writeOnly());
      expect(stored(id).status).toBe("done");
      expect(allDone(id)).toBe(true);
    });
  });

  describe("update_task, the order of its writes", () => {
    const writes = () =>
      vi.mocked(updateRow).mock.calls.map(([, , patch]) => Object.keys(patch));

    it("saves the list first, then the other fields", async () => {
      const { id } = await seed([a, b]);
      await update({
        id,
        title: "Barn",
        subtasks: [{ title: "Water" }, { title: "Weed", done: true }],
      });
      expect(writes()).toEqual([["title"]]);
      const [list] = vi.mocked(rewriteRow).mock.invocationCallOrder;
      const [title] = vi.mocked(updateRow).mock.invocationCallOrder;
      expect(list).toBeLessThan(title);
    });

    it("stops when the task is gone before the list is saved", async () => {
      const { id } = await seed([a, b]);
      vi.mocked(rewriteRow).mockResolvedValueOnce(null);
      const out = await update({
        id,
        title: "Barn",
        subtasks: [{ title: "Water" }, { title: "Weed", done: true }],
      });
      expect(data(out).ok).toBe(false);
      expect(out.text).toContain("No task with id");
      expect(updateRow).not.toHaveBeenCalled();
    });

    it("says so when the task is deleted between the two writes", async () => {
      const { id } = await seed([a, b]);
      const real =
        await vi.importActual<typeof import("@/lib/db/tasks")>("@/lib/db/tasks");
      vi.mocked(rewriteRow).mockImplementationOnce(async (user, rowId, build) => {
        const saved = await real.rewriteSubtasks(user, rowId, build);
        await real.deleteTask(user, rowId);
        return saved;
      });
      expect(data(await complete(id, true)).ok).toBe(false);
    });

    it("builds the list from what is stored when it writes, not from an earlier read", async () => {
      const { id } = await seed([a, b]);
      const real =
        await vi.importActual<typeof import("@/lib/db/tasks")>("@/lib/db/tasks");
      // Someone adds a row right before the write.
      vi.mocked(rewriteRow).mockImplementationOnce(async (user, rowId, build) => {
        await real.changeSubtask(user, rowId, {
          kind: "add",
          id: "c",
          title: "Plant",
        });
        return real.rewriteSubtasks(user, rowId, build);
      });
      await complete(id, true);
      expect(stored(id).subtasks.map((s) => [s.title, s.done])).toEqual([
        ["Water", true],
        ["Weed", true],
        ["Plant", true],
      ]);
    });
  });

  describe("update_task status", () => {
    it("leaves the boxes alone when status goes to done", async () => {
      const { id } = await seed([a, b]);
      const before = stored(id).subtasks;
      const out = await update({ id, status: "done" });
      expect(data(out).changed).toEqual(["status"]);
      expect(stored(id).status).toBe("done");
      expect(stored(id).completedAt).not.toBeNull();
      expect(stored(id).subtasks).toBe(before);
      expect(rewriteRow).not.toHaveBeenCalled();
    });

    it("takes a list sent along with done", async () => {
      const { id } = await seed([a, b]);
      await update({
        id,
        status: "done",
        subtasks: [{ title: "Water", done: false }, { title: "Weed" }],
      });
      expect(stored(id).status).toBe("done");
      expect(stored(id).subtasks).toEqual([{ ...a, done: false }, b]);
    });

    it("leaves the ticks alone when a task is reopened", async () => {
      const { id } = await seed([a, b], { completedAt: "2026-10-02" });
      const out = await update({ id, status: "todo" });
      expect(data(out).changed).toEqual(["status"]);
      expect(stored(id).subtasks).toEqual([a, b]);
      expect(stored(id).completedAt).toBeNull();
    });

    it("applies other fields without restamping a closed task", async () => {
      const { id } = await seed([a], { completedAt: "2026-10-02" });
      const out = await update({ id, status: "done", title: "Barn" });
      expect(data(out).changed).toEqual(["title"]);
      expect(stored(id).title).toBe("Barn");
      expect(stored(id).completedAt).toBe("2026-10-02");
    });

    it("leaves the list alone on a change to anything else", async () => {
      const { id } = await seed([a, b]);
      const before = stored(id).subtasks;
      const out = await update({ id, title: "Barn" });
      expect(data(out).changed).toEqual(["title"]);
      expect(stored(id).subtasks).toBe(before);
    });
  });

  describe("update_task edges", () => {
    it("does not rewrite a list that already matches", async () => {
      const { id } = await seed([a]);
      const before = stored(id).subtasks;
      const out = await update({ id, subtasks: [{ title: "Water" }] });
      expect(data(out)).toEqual({ ok: true, id, changed: [] });
      expect(stored(id).subtasks).toBe(before);
    });

    it("still says so when no fields are given", async () => {
      const { id } = await seed([a]);
      const out = await update({ id });
      expect(data(out).ok).toBe(false);
      expect(out.text).toMatch(/Nothing to change/);
    });

    it("writes nothing for an unknown id", async () => {
      const before = structuredClone(getStore().tasks);
      const out = await update({ id: "nope", subtasks: [{ title: "Water" }] });
      expect(data(out).ok).toBe(false);
      expect(getStore().tasks).toEqual(before);
    });

    it("cannot reach another account's task", async () => {
      const { id } = await seed([a, b]);
      const caller = await callerWith(true);
      const out = await update(
        { id, subtasks: [{ title: "Stolen" }] },
        { ...caller, userId: "someone-else" },
      );
      expect(data(out).ok).toBe(false);
      expect(stored(id).subtasks).toEqual([a, b]);
    });
  });

  describe("complete_task", () => {
    it("closes the task and leaves its boxes alone", async () => {
      const { id } = await seed([a, b]);
      const before = stored(id).subtasks;
      const out = await complete(id);
      expect(data(out)).toEqual({ ok: true, id, changed: ["status"] });
      expect(stored(id).status).toBe("done");
      expect(stored(id).subtasks).toBe(before);
      expect(rewriteRow).not.toHaveBeenCalled();
    });

    it("ticks every box only when asked", async () => {
      const { id } = await seed([a, b]);
      const out = await complete(id, true);
      expect(data(out)).toEqual({
        ok: true,
        id,
        changed: ["status", "subtasks"],
      });
      expect(stored(id).status).toBe("done");
      expect(allDone(id)).toBe(true);
    });

    it("reports only the status, with no second write, when asked to tick and every box is ticked", async () => {
      const { id } = await seed([a]);
      const before = stored(id).subtasks;
      const out = await complete(id, true);
      expect(data(out).changed).toEqual(["status"]);
      expect(stored(id).subtasks).toBe(before);
    });

    it("can tick a closed task's boxes without moving its completion date", async () => {
      const { id } = await seed([a, b], { completedAt: "2020-01-02" });
      const out = await complete(id, true);
      expect(data(out).changed).toEqual(["subtasks"]);
      expect(allDone(id)).toBe(true);
      expect(stored(id).completedAt).toBe("2020-01-02");
    });

    it("stamps a done task that has no completion date", async () => {
      const { id } = await seed([], { completedAt: null });
      const out = await complete(id);
      expect(data(out).changed).toEqual(["status"]);
      expect(stored(id).completedAt).not.toBeNull();
    });

    it("is safe to call twice", async () => {
      const { id } = await seed([a, b], { completedAt: "2020-01-02" });
      await complete(id, true);
      const out = await complete(id, true);
      expect(data(out)).toEqual({ ok: true, id, changed: [] });
      expect(stored(id).completedAt).toBe("2020-01-02");
    });

    it("answers for an unknown id", async () => {
      expect(data(await complete("nope")).ok).toBe(false);
    });

    it("moves the goal above the task", async () => {
      const { one, progress } = await goalOverProject();
      await complete(one.id);
      expect(progress()).toBe(50);
    });

    it("repairs a stale goal when called again", async () => {
      const { goal, one, progress } = await goalOverProject();
      await complete(one.id);
      // As if the first call closed the task and then failed writing the goal.
      await updateGoal(userId, goal.id, { progress: 0 });
      const out = await complete(one.id);
      expect(data(out).ok).toBe(true);
      expect(progress()).toBe(50);
    });
  });

  describe("the published schema", () => {
    const tools = [createTask, updateTask];
    const accepts = (tool: (typeof tools)[number], subtasks: unknown) =>
      tool.inputSchema.safeParse({ id: "x", title: "t", subtasks }).success;

    it("takes a list of titles with an optional tick", () => {
      for (const tool of tools) {
        expect(accepts(tool, [{ title: "ok" }])).toBe(true);
        expect(accepts(tool, [{ title: "ok", done: true }])).toBe(true);
      }
    });

    it("holds the limits of the app's editor", () => {
      for (const tool of tools) {
        expect(accepts(tool, [{ title: "x".repeat(500) }])).toBe(true);
        expect(accepts(tool, [{ title: "x".repeat(501) }])).toBe(false);
        expect(accepts(tool, Array(200).fill({ title: "x" }))).toBe(true);
        expect(accepts(tool, Array(201).fill({ title: "x" }))).toBe(false);
      }
    });

    it("refuses blank and multi-line titles, and unknown keys", () => {
      for (const tool of tools) {
        expect(accepts(tool, [{ title: "" }])).toBe(false);
        expect(accepts(tool, [{ title: "   " }])).toBe(false);
        expect(accepts(tool, [{ title: "a\nb" }])).toBe(false);
        expect(accepts(tool, [{ title: "a\rb" }])).toBe(false);
        expect(accepts(tool, [{ title: "a", completed: true }])).toBe(false);
      }
    });

    it("takes any title the app's own input can store, so a list can be sent back", () => {
      for (const tool of tools) {
        expect(accepts(tool, [{ title: "a\u2028b" }])).toBe(true);
        expect(accepts(tool, [{ title: "a\u2029b" }])).toBe(true);
      }
    });

    it("reaches a client through the real schema shim", () => {
      for (const tool of tools) {
        const json = toolInput(tool.inputSchema)["~standard"].jsonSchema.input({
          target: "draft-2020-12",
        }) as {
          properties: {
            subtasks: {
              maxItems: number;
              items: {
                additionalProperties: boolean;
                required: string[];
                properties: { title: { maxLength: number; pattern: string } };
              };
            };
          };
        };
        const field = json.properties.subtasks;
        expect(field.maxItems).toBe(200);
        expect(field.items.required).toEqual(["title"]);
        expect(field.items.additionalProperties).toBe(false);
        expect(field.items.properties.title.maxLength).toBe(500);
        const oneLine = new RegExp(field.items.properties.title.pattern);
        expect(oneLine.test("one line")).toBe(true);
        expect(oneLine.test("two\nlines")).toBe(false);
      }
    });
  });
});
