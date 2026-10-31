// A task's place in its column through the MCP: the pure rules, then the real tool handlers on the memory store.
import { beforeEach, describe, expect, it } from "vitest";
import { sortTasks } from "@/lib/collection-sort";
import { getSettings } from "@/lib/db/memory/settings";
import { insertTask, listTasks } from "@/lib/db/memory/tasks";
import type { McpCaller } from "@/lib/mcp/context";
import { MCP_SCOPE } from "@/lib/mcp/config";
import { runTool } from "@/lib/mcp/registry";
import { toolInput } from "@/lib/mcp/schema";
import {
  boardNote,
  columnOf,
  columnPositions,
  orderPatches,
  placeAfter,
} from "@/lib/mcp/task-position";
import { listTasksTool } from "@/lib/mcp/tools/read";
import { moveTask } from "@/lib/mcp/tools/write";
import type { Settings, Task } from "@/lib/schemas";
import { getCurrentUserId, getStore, resetStore } from "@/lib/store/memory";

function task(over: Partial<Task> & { id: string }): Task {
  return {
    userId: "u",
    title: "t",
    description: "",
    subtasks: [],
    tagIds: [],
    priority: "med",
    status: "todo",
    due: null,
    projectId: "p",
    goalId: null,
    lifeArea: "personal",
    order: 0,
    createdAt: "",
    completedAt: null,
    timeSpentSec: 0,
    timerStartedAt: null,
    ...over,
  } as Task;
}

describe("columnOf", () => {
  it("takes one project and status, in the Custom order", () => {
    const tasks = [
      task({ id: "late", order: 5 }),
      task({ id: "early", order: 1 }),
      task({ id: "doing", order: 0, status: "doing" }),
      task({ id: "other", order: 0, projectId: "q" }),
      task({ id: "loose", order: 0, projectId: null }),
    ];
    expect(columnOf(tasks, "p", "todo").map((t) => t.id)).toEqual([
      "early",
      "late",
    ]);
  });
});

describe("equal order numbers", () => {
  const tied = ["x", "y", "z"].map((id) => task({ id, order: 5 }));

  it("keep the list's order, as the board does", () => {
    expect(columnOf(tied, "p", "todo").map((t) => t.id)).toEqual(["x", "y", "z"]);
    const at = columnPositions(tied);
    expect(["x", "y", "z"].map((id) => at.get(id))).toEqual([1, 2, 3]);
  });
});

describe("columnPositions", () => {
  it("counts from 1 within each column", () => {
    const tasks = [
      task({ id: "b", order: 2 }),
      task({ id: "a", order: 1 }),
      task({ id: "d", order: 9, status: "doing" }),
      task({ id: "q", order: 7, projectId: "q" }),
    ];
    const at = columnPositions(tasks);
    expect(at.get("a")).toBe(1);
    expect(at.get("b")).toBe(2);
    expect(at.get("d")).toBe(1);
    expect(at.get("q")).toBe(1);
  });

  it("gives a task with no project no position", () => {
    const at = columnPositions([task({ id: "x", projectId: null })]);
    expect(at.has("x")).toBe(false);
  });

  it("puts a task never arranged by hand on top, by its negative stamp", () => {
    const at = columnPositions([
      task({ id: "old", order: 0 }),
      task({ id: "new", order: -1_790_000_000_000 }),
    ]);
    expect(at.get("new")).toBe(1);
    expect(at.get("old")).toBe(2);
  });
});

describe("placeAfter", () => {
  const column = ["a", "b", "c"];

  it("goes right below the named task", () => {
    expect(placeAfter(column, "a", "c")).toEqual(["b", "c", "a"]);
    expect(placeAfter(column, "c", "a")).toEqual(["a", "c", "b"]);
  });

  it("goes on top for null", () => {
    expect(placeAfter(column, "c", null)).toEqual(["c", "a", "b"]);
  });

  it("gives the same order back when already there", () => {
    expect(placeAfter(column, "b", "a")).toEqual(column);
    expect(placeAfter(column, "a", null)).toEqual(column);
  });

  it("gives nothing when the target is not in the column", () => {
    expect(placeAfter(column, "a", "z")).toBeNull();
    expect(placeAfter(column, "a", "a")).toBeNull();
  });
});

describe("orderPatches", () => {
  it("numbers from 0 and leaves out rows already right", () => {
    const column = [
      task({ id: "a", order: 0 }),
      task({ id: "b", order: 1 }),
      task({ id: "c", order: 2 }),
    ];
    expect(orderPatches(column, ["a", "c", "b"])).toEqual([
      { id: "c", patch: { order: 1 } },
      { id: "b", patch: { order: 2 } },
    ]);
  });

  it("replaces creation stamps with plain numbers", () => {
    const column = [task({ id: "a", order: -9 }), task({ id: "b", order: -8 })];
    expect(orderPatches(column, ["a", "b"])).toEqual([
      { id: "a", patch: { order: 0 } },
      { id: "b", patch: { order: 1 } },
    ]);
  });
});

describe("boardNote", () => {
  it("says nothing when the board shows this order", () => {
    expect(
      boardNote({ projectTaskSort: "custom", sortReversed: [] }),
    ).toBe("");
    expect(
      boardNote({ projectTaskSort: "custom", sortReversed: ["task", "note"] }),
    ).toBe("");
  });

  it("names the sort in the way, as the menu names it", () => {
    const note = boardNote({ projectTaskSort: "priority", sortReversed: [] });
    expect(note).toContain("Priority");
    expect(note).toContain("Custom");
    expect(
      boardNote({ projectTaskSort: "alpha", sortReversed: [] }),
    ).toContain("A to Z");
  });

  it("says so when Custom runs in reverse", () => {
    expect(
      boardNote({ projectTaskSort: "custom", sortReversed: ["projectTask"] }),
    ).toContain("reverse");
  });
});

describe("the MCP tools", () => {
  const userId = getCurrentUserId();

  async function callerWith(
    over: Partial<Pick<Settings, "projectTaskSort" | "sortReversed">> = {},
  ): Promise<McpCaller> {
    const settings = (await getSettings(userId))!;
    return {
      userId,
      clientId: "test-client",
      scopes: new Set([MCP_SCOPE.read, MCP_SCOPE.write]),
      settings: {
        ...settings,
        projectTaskSort: "custom",
        sortReversed: [],
        ...over,
        mcp: { ...settings.mcp, enabled: true },
      },
      timeZone: "UTC",
    };
  }

  type Moved = {
    ok: boolean;
    id?: string;
    position?: number;
    changed?: string[];
  };
  const moved = (out: { data?: unknown }) => out.data as Moved;

  // Through the schema, as the server does.
  const move = async (input: unknown, caller?: McpCaller) =>
    moveTask.handler(
      moveTask.inputSchema.parse(input),
      caller ?? (await callerWith()),
    );

  function seed(
    title: string,
    order: number,
    over: { status?: Task["status"]; projectId?: string | null; userId?: string } = {},
  ): Promise<{ id: string }> {
    const status = over.status ?? "todo";
    return insertTask({
      userId: over.userId ?? userId,
      title,
      description: "",
      subtasks: [],
      tagIds: [],
      priority: "med",
      status,
      due: null,
      projectId: over.projectId === undefined ? "p" : over.projectId,
      goalId: null,
      lifeArea: "personal",
      order,
      createdAt: "2026-10-01",
      completedAt: status === "done" ? "2026-10-02" : null,
    });
  }

  /** What the board shows for a column under Custom, by title. */
  async function board(status: Task["status"] = "todo", projectId = "p") {
    const rows = (await listTasks(userId)).filter(
      (t) => t.projectId === projectId && t.status === status,
    );
    return sortTasks(rows, "custom").map((t) => t.title);
  }

  const row = (id: string) => getStore().tasks.find((t) => t._id === id)!;

  beforeEach(() => {
    resetStore();
    getStore().tasks.length = 0;
  });

  describe("move_task", () => {
    it("puts a task right below another, and the board shows it there", async () => {
      const a = await seed("a", 0);
      await seed("b", 1);
      const c = await seed("c", 2);
      const out = await move({ id: a.id, after: c.id });
      expect(moved(out)).toEqual({
        ok: true,
        id: a.id,
        position: 3,
        changed: ["order"],
      });
      expect(await board()).toEqual(["b", "c", "a"]);
    });

    it("puts a task on top for null", async () => {
      await seed("a", 0);
      await seed("b", 1);
      const c = await seed("c", 2);
      const out = await move({ id: c.id, after: null });
      expect(moved(out).position).toBe(1);
      expect(await board()).toEqual(["c", "a", "b"]);
    });

    it("places a task made in a chat, which starts on top by its stamp", async () => {
      await seed("first", 0);
      const last = await seed("last", 1);
      const fresh = await seed("studio testing", -1_790_000_000_000);
      expect(await board()).toEqual(["studio testing", "first", "last"]);
      await move({ id: fresh.id, after: last.id });
      expect(await board()).toEqual(["first", "last", "studio testing"]);
    });

    it("works on the done column, without touching status or the date", async () => {
      const a = await seed("a", 0, { status: "done" });
      const b = await seed("b", 1, { status: "done" });
      await move({ id: a.id, after: b.id });
      expect(await board("done")).toEqual(["b", "a"]);
      expect(row(a.id).status).toBe("done");
      expect(row(a.id).completedAt).toBe("2026-10-02");
    });

    it("leaves other columns and projects alone, and writes only rows that moved", async () => {
      const a = await seed("a", 0);
      const b = await seed("b", 1);
      const c = await seed("c", 2);
      const d = await seed("d", 3);
      const doing = await seed("doing", 0, { status: "doing" });
      const other = await seed("other", 0, { projectId: "q" });
      const loose = await seed("loose", 0, { projectId: null });
      const untouched = [a, d, doing, other, loose].map((t) => row(t.id));

      const out = await move({ id: c.id, after: a.id });

      expect(await board()).toEqual(["a", "c", "b", "d"]);
      expect(new Set(out.entityIds)).toEqual(new Set([c.id, b.id]));
      for (const [i, t] of [a, d, doing, other, loose].entries()) {
        expect(row(t.id)).toBe(untouched[i]);
      }
      expect(row(c.id).order).toBe(1);
      expect(row(b.id).order).toBe(2);
    });

    it("lists the moved task in the audit even when its own number stays", async () => {
      const a = await seed("a", 1);
      const b = await seed("b", 1);
      // The memory store lists newest first, so a tie starts as b, a.
      expect(await board()).toEqual(["b", "a"]);
      const out = await move({ id: b.id, after: a.id });
      expect(await board()).toEqual(["a", "b"]);
      expect(row(b.id).order).toBe(1);
      expect(new Set(out.entityIds)).toEqual(new Set([a.id, b.id]));
    });

    it("writes nothing when the task is already there", async () => {
      const a = await seed("a", 10);
      const b = await seed("b", 20);
      const before = [row(a.id), row(b.id)];
      for (const input of [
        { id: b.id, after: a.id },
        { id: a.id, after: null },
      ]) {
        const out = await move(input);
        expect(moved(out).ok).toBe(true);
        expect(moved(out).changed).toEqual([]);
        expect(out.text).toMatch(/Nothing changed/);
        expect(out.entityIds).toEqual([input.id]);
      }
      expect(row(a.id)).toBe(before[0]);
      expect(row(b.id)).toBe(before[1]);
    });

    it("says where the task went", async () => {
      const a = await seed("a", 0);
      const b = await seed("b", 1);
      expect((await move({ id: a.id, after: b.id })).text).toContain(`below ${b.id}`);
      expect((await move({ id: a.id, after: null })).text).toContain("top");
    });

    describe("refuses, and writes nothing", () => {
      async function refused(input: unknown, reason: RegExp, caller?: McpCaller) {
        const before = structuredClone(getStore().tasks);
        const out = await move(input, caller);
        expect(moved(out).ok).toBe(false);
        expect(out.text).toMatch(reason);
        expect(getStore().tasks).toEqual(before);
      }

      it("for a task that does not exist", async () => {
        const a = await seed("a", 0);
        await refused({ id: "nope", after: a.id }, /No task with id nope/);
      });

      it("for a task with no project", async () => {
        const loose = await seed("loose", 0, { projectId: null });
        await refused({ id: loose.id, after: null }, /no project/);
      });

      it("for a task asked to go below itself", async () => {
        const a = await seed("a", 0);
        await refused({ id: a.id, after: a.id }, /below itself/);
      });

      it("for a target in another column, since a move never changes status", async () => {
        const a = await seed("a", 0);
        const doing = await seed("doing", 0, { status: "doing" });
        await refused({ id: a.id, after: doing.id }, /same project and status/);
        expect(row(a.id).status).toBe("todo");
      });

      it("for a target in another project", async () => {
        const a = await seed("a", 0);
        const other = await seed("other", 0, { projectId: "q" });
        await refused({ id: a.id, after: other.id }, /same project and status/);
      });

      it("for a target that does not exist", async () => {
        const a = await seed("a", 0);
        await refused({ id: a.id, after: "nope" }, /same project and status/);
      });

      it("for another account's task", async () => {
        const mine = await seed("mine", 0);
        const theirs = await seed("theirs", 1, { userId: "someone-else" });
        await refused({ id: theirs.id, after: null }, /No task with id/);
        await refused({ id: mine.id, after: theirs.id }, /same project and status/);
      });
    });

    describe("the note about the board", () => {
      it("is there when the board is not on Custom", async () => {
        const a = await seed("a", 0);
        const b = await seed("b", 1);
        const out = await move(
          { id: a.id, after: b.id },
          await callerWith({ projectTaskSort: "priority" }),
        );
        expect(out.text).toContain("sorted by Priority");
      });

      it("is there when nothing moved too, since it explains what they see", async () => {
        const a = await seed("a", 0);
        const out = await move(
          { id: a.id, after: null },
          await callerWith({ projectTaskSort: "priority" }),
        );
        expect(out.text).toContain("sorted by Priority");
      });

      it("is gone under Custom", async () => {
        const a = await seed("a", 0);
        const b = await seed("b", 1);
        const out = await move({ id: a.id, after: b.id });
        expect(out.text).not.toMatch(/sorted by|reverse/);
      });

      it("never changes the board's sort", async () => {
        const a = await seed("a", 0);
        const b = await seed("b", 1);
        const stored = structuredClone(await getSettings(userId));
        await move(
          { id: a.id, after: b.id },
          await callerWith({ projectTaskSort: "alpha" }),
        );
        expect(await getSettings(userId)).toEqual(stored);
      });
    });

    describe("the gates", () => {
      it("is refused with editing off", async () => {
        const a = await seed("a", 0);
        const b = await seed("b", 1);
        const caller = await callerWith();
        const off: McpCaller = {
          ...caller,
          settings: {
            ...caller.settings,
            mcp: { ...caller.settings.mcp, allowUpdate: false },
          },
        };
        const result = await runTool(moveTask, off)(
          moveTask.inputSchema.parse({ id: a.id, after: b.id }),
        );
        expect("isError" in result && result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/Editing items over MCP is disabled/);
        expect(row(a.id).order).toBe(0);
      });

      it("is refused on a read-only connection", async () => {
        const a = await seed("a", 0);
        const b = await seed("b", 1);
        const caller = await callerWith();
        const result = await runTool(moveTask, {
          ...caller,
          scopes: new Set([MCP_SCOPE.read]),
        })(moveTask.inputSchema.parse({ id: a.id, after: b.id }));
        expect("isError" in result && result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/missing pumma:write/);
        expect(row(a.id).order).toBe(0);
      });

      it("needs no delete permission", async () => {
        const a = await seed("a", 0);
        const b = await seed("b", 1);
        const result = await runTool(moveTask, await callerWith())(
          moveTask.inputSchema.parse({ id: a.id, after: b.id }),
        );
        expect("isError" in result).toBe(false);
      });
    });

    describe("the published schema", () => {
      it("needs both fields, and after may be null", () => {
        const accepts = (input: unknown) =>
          moveTask.inputSchema.safeParse(input).success;
        expect(accepts({ id: "a", after: "b" })).toBe(true);
        expect(accepts({ id: "a", after: null })).toBe(true);
        expect(accepts({ id: "a" })).toBe(false);
        expect(accepts({ after: "b" })).toBe(false);
      });

      it("reaches a client through the real schema shim", () => {
        const json = toolInput(moveTask.inputSchema)[
          "~standard"
        ].jsonSchema.input({ target: "draft-2020-12" }) as {
          required: string[];
          properties: { after: { anyOf: { type: string }[] } };
        };
        expect(json.required.sort()).toEqual(["after", "id"]);
        expect(json.properties.after.anyOf.map((o) => o.type)).toEqual([
          "string",
          "null",
        ]);
      });
    });
  });

  describe("list_tasks", () => {
    type Row = { id: string; position: number | null };
    const list = async (input: unknown = {}) => {
      const out = await listTasksTool.handler(
        listTasksTool.inputSchema.parse(input),
        await callerWith(),
      );
      const rows = (out.data as { tasks: Row[] }).tasks;
      return {
        text: out.text,
        at: (id: string) => rows.find((r) => r.id === id)?.position,
      };
    };

    it("gives each project task its place in its column", async () => {
      const a = await seed("a", 0);
      const b = await seed("b", 1);
      const doing = await seed("doing", 0, { status: "doing" });
      const { at } = await list();
      expect(at(a.id)).toBe(1);
      expect(at(b.id)).toBe(2);
      expect(at(doing.id)).toBe(1);
    });

    it("gives null for a task with no project", async () => {
      const loose = await seed("loose", 0, { projectId: null });
      expect((await list()).at(loose.id)).toBeNull();
    });

    it("keeps the real position through a filter and a limit", async () => {
      await seed("alpha", 0);
      await seed("beta", 1);
      const c = await seed("gamma", 2);
      expect((await list({ query: "gamma" })).at(c.id)).toBe(3);
      expect((await list({ priority: ["med"], projectId: "p" })).at(c.id)).toBe(3);
    });

    it("shows the position in the text a model reads", async () => {
      const a = await seed("a", 0);
      const b = await seed("b", 1);
      const loose = await seed("loose", 0, { projectId: null });
      const { text } = await list();
      const line = (id: string) => text.split("\n").find((l) => l.includes(id))!;
      expect(line(a.id)).toContain("position 1");
      expect(line(b.id)).toContain("position 2");
      expect(line(loose.id)).not.toContain("position");
    });

    it("agrees with a move", async () => {
      const a = await seed("a", 0);
      const b = await seed("b", 1);
      const c = await seed("c", 2);
      await move({ id: a.id, after: b.id });
      const { at } = await list();
      expect([at(b.id), at(a.id), at(c.id)]).toEqual([1, 2, 3]);
    });
  });
});
