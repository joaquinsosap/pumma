/**
 * Create and update tools.
 *
 * Apart from a task's subtask list and order, the habit log and goal progress,
 * these do not write rows themselves. They build the same op the assistant's changeset
 * builds and hand it to `lib/mutations/entities`, which is also what
 * the UI's server actions go through. That is the whole point of the
 * extraction: creating a project mints its flagship tag, filing a task under
 * one moves its project tag and adds that flagship, every entity carries a
 * life tag and derives `lifeArea` from it, a goal's category mirrors its life
 * area, and finishing a task restamps its project's progress. None of that is
 * obvious, none of it is local, and a second implementation of it here would
 * drift from the first within a month.
 *
 * `resolveExisting` is passed as the reference resolver because MCP callers
 * work with ids that already exist. The assistant needs a real resolver so an
 * op can point at a row created earlier in the same batch; nothing here has a
 * batch.
 */
import "server-only";
import * as z from "zod/v4";
import { defineTool } from "@/lib/mcp/registry";
import {
  applyCreate,
  applyUpdate,
  resolveExisting,
  type Ctx,
} from "@/lib/mutations/entities";
import { listTags } from "@/lib/db/tags";
import { listHabits } from "@/lib/db/habits";
import { markHabitEntry } from "@/lib/db/habitEntries";
import { listGoals, updateGoal as updateGoalRow } from "@/lib/db/goals";
import {
  getTask,
  listTasks,
  updateTask as updateTaskRow,
  updateTasks,
} from "@/lib/db/tasks";
import { syncGoalsForProject } from "@/lib/goal-sync-server";
import { isoDateInTz } from "@/lib/timezone";
import {
  assertMcpAllowed,
  assertScope,
  McpPolicyError,
  McpScopeError,
} from "@/lib/mcp/policy";
import {
  sameSubtasks,
  subtaskChanges,
  subtasksFromInput,
  tickedSubtasks,
  type SubtaskInput,
} from "@/lib/mcp/subtasks";
import {
  boardNote,
  columnOf,
  orderPatches,
  placeAfter,
} from "@/lib/mcp/task-position";
import type { McpCaller } from "@/lib/mcp/context";
import type { CreateOp, UpdateOp } from "@/lib/ai/changeset-schema";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .describe("YYYY-MM-DD");

// Same limits as the app's own task editor, which also trims and keeps a title to one line.
const subtasksField = z
  .array(
    z.strictObject({
      title: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .regex(/^[^\r\n]+$/, "Keep a subtask title to one line"),
      done: z.boolean().optional(),
    }),
  )
  .max(200);

const lifeArea = z.enum(["personal", "work"]);

/** Build the context the mutation layer expects for a single-entity write. */
async function contextFor(caller: McpCaller): Promise<Ctx> {
  return {
    td: isoDateInTz(new Date(), caller.timeZone),
    tags: await listTags(caller.userId),
    resolve: resolveExisting,
    touchedProjects: new Set<string>(),
  };
}

/**
 * Recompute the goals above any project this call disturbed.
 *
 * A project's own percentage is derived at render time from its tasks
 * (`projectProgress` in lib/metrics), so nothing needs writing for that. A
 * GOAL's progress is different: it is stored, and it is computed from the
 * projects, tasks and habits underneath it, so finishing a task leaves the
 * goal above it stale until someone says so. The mutation layer records which
 * projects were touched; this is where that gets acted on, exactly as the
 * changeset apply path and the UI's own actions do.
 */
async function settle(caller: McpCaller, ctx: Ctx): Promise<void> {
  for (const projectId of ctx.touchedProjects) {
    await syncGoalsForProject(caller.userId, projectId);
  }
}

/** Drop undefined so an omitted field reads as "unchanged", never as "clear". */
function fields<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined),
  ) as T;
}

// ---------------------------------------------------------------------------
// Create

export const createTask = defineTool({
  name: "create_task",
  title: "Create a task",
  description:
    "Add a task. Returns its id. To put it in a project, pass a projectId from list_projects. " +
    "A new task lands on top of its column; move_task places it elsewhere.",
  opClass: "create",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    due: isoDate.optional(),
    priority: z.enum(["low", "med", "high"]).optional().describe("Defaults to med."),
    projectId: z.string().optional(),
    lifeArea: lifeArea.optional().describe("Defaults to personal."),
    tags: z
      .array(z.string().max(40))
      .max(10)
      .optional()
      .describe("Tag names. Created if they do not exist."),
    subtasks: subtasksField
      .optional()
      .describe("The task's checklist. done defaults to false."),
  }),
  handler: async (input, caller) => {
    const ctx = await contextFor(caller);
    const op: CreateOp = {
      op: "create" as const,
      entity: "task",
      refId: "mcp",
      fields: fields({
        title: input.title,
        description: input.description,
        date: input.due,
        priority: input.priority,
        projectId: input.projectId,
        lifeArea: input.lifeArea,
        tagNames: input.tags,
      }),
    } as CreateOp;
    const made = await applyCreate(caller.userId, op, ctx, {
      subtasks: subtasksFromInput(input.subtasks ?? [], []),
    });
    if (!made) return { text: "Could not create that task.", data: { ok: false } };

    const text = `Created task "${made.title}" (id ${made.id}).`;
    const data = { ok: true, id: made.id, title: made.title };
    try {
      await settle(caller, ctx);
    } catch (err) {
      // The row is in: an error here would read as failed, and a retry would make a second task.
      console.error("[mcp] create_task: goal sync failed", err);
      return {
        text: `${text} If its project has a goal, that goal did not update, and catches up the next time a task in that project changes status. Do not create this task again.`,
        data: { ...data, goalSynced: false },
        entityIds: [made.id],
      };
    }
    return { text, data, entityIds: [made.id] };
  },
});

export const createNote = defineTool({
  name: "create_note",
  title: "Create a note",
  description: "Add a note. Returns its id.",
  opClass: "create",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    body: z.string().max(20000).optional(),
    lifeArea: lifeArea.optional(),
    tags: z.array(z.string().max(40)).max(10).optional(),
  }),
  handler: async (input, caller) => {
    const ctx = await contextFor(caller);
    const made = await applyCreate(
      caller.userId,
      {
        op: "create" as const,
        entity: "note",
        refId: "mcp",
        fields: fields({
          title: input.title,
          description: input.body,
          lifeArea: input.lifeArea,
          tagNames: input.tags,
        }),
      } as CreateOp,
      ctx,
    );
    await settle(caller, ctx);
    if (!made) return { text: "Could not create that note.", data: { ok: false } };
    return {
      text: `Created note "${made.title}" (id ${made.id}).`,
      data: { ok: true, id: made.id, title: made.title },
      entityIds: [made.id],
    };
  },
});

export const createProject = defineTool({
  name: "create_project",
  title: "Create a project",
  description:
    "Add a project. Returns its id. A tag named after the project is created with it, which is how tasks get filed into it.",
  opClass: "create",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    goalId: z.string().optional().describe("Link it to a goal, from list_goals."),
    lifeArea: lifeArea.optional(),
  }),
  handler: async (input, caller) => {
    const ctx = await contextFor(caller);
    const made = await applyCreate(
      caller.userId,
      {
        op: "create" as const,
        entity: "project",
        refId: "mcp",
        fields: fields({
          title: input.title,
          description: input.description,
          goalId: input.goalId,
          lifeArea: input.lifeArea,
        }),
      } as CreateOp,
      ctx,
    );
    await settle(caller, ctx);
    if (!made) return { text: "Could not create that project.", data: { ok: false } };
    return {
      text: `Created project "${made.title}" (id ${made.id}).`,
      data: { ok: true, id: made.id, title: made.title },
      entityIds: [made.id],
    };
  },
});

export const createGoal = defineTool({
  name: "create_goal",
  title: "Create a goal",
  description:
    "Add a goal. Returns its id. Progress is derived from the work underneath it, so it cannot be set directly.",
  opClass: "create",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    targetDate: isoDate.optional(),
    lifeArea: lifeArea.optional(),
  }),
  handler: async (input, caller) => {
    const ctx = await contextFor(caller);
    const made = await applyCreate(
      caller.userId,
      {
        op: "create" as const,
        entity: "goal",
        refId: "mcp",
        fields: fields({
          title: input.title,
          date: input.targetDate,
          lifeArea: input.lifeArea,
        }),
      } as CreateOp,
      ctx,
    );
    await settle(caller, ctx);
    if (!made) return { text: "Could not create that goal.", data: { ok: false } };
    return {
      text: `Created goal "${made.title}" (id ${made.id}).`,
      data: { ok: true, id: made.id, title: made.title },
      entityIds: [made.id],
    };
  },
});

export const createHabit = defineTool({
  name: "create_habit",
  title: "Create a habit",
  description: "Add a habit. Returns its id.",
  opClass: "create",
  inputSchema: z.object({
    name: z.string().min(1).max(200),
    frequency: z.enum(["daily", "weekly", "monthly"]).optional().describe("Defaults to daily."),
    lifeArea: lifeArea.optional(),
  }),
  handler: async (input, caller) => {
    const ctx = await contextFor(caller);
    const made = await applyCreate(
      caller.userId,
      {
        op: "create" as const,
        entity: "habit",
        refId: "mcp",
        fields: fields({
          title: input.name,
          frequency: input.frequency,
          lifeArea: input.lifeArea,
        }),
      } as CreateOp,
      ctx,
    );
    await settle(caller, ctx);
    if (!made) return { text: "Could not create that habit.", data: { ok: false } };
    return {
      text: `Created habit "${made.title}" (id ${made.id}).`,
      data: { ok: true, id: made.id, title: made.title },
      entityIds: [made.id],
    };
  },
});

export const createMeeting = defineTool({
  name: "create_meeting",
  title: "Create a meeting",
  description:
    "Add a meeting to the user's own agenda. Cannot touch events from subscribed calendars, which are read-only mirrors.",
  opClass: "create",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    date: isoDate.describe("The day, or the first day when it repeats."),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, 24 hour")
      .describe("HH:MM, 24 hour."),
    durationMins: z.number().int().min(5).max(600).default(30),
    notes: z.string().max(1000).optional(),
    lifeArea: lifeArea.optional(),
  }),
  handler: async (input, caller) => {
    const ctx = await contextFor(caller);
    const made = await applyCreate(
      caller.userId,
      {
        op: "create" as const,
        entity: "meeting",
        refId: "mcp",
        fields: fields({
          title: input.title,
          date: input.date,
          time: input.time,
          durationMins: input.durationMins,
          description: input.notes,
          lifeArea: input.lifeArea,
        }),
      } as CreateOp,
      ctx,
    );
    await settle(caller, ctx);
    if (!made) return { text: "Could not create that meeting.", data: { ok: false } };
    return {
      text: `Created meeting "${made.title}" on ${input.date} at ${input.time} (id ${made.id}).`,
      data: { ok: true, id: made.id, title: made.title },
      entityIds: [made.id],
    };
  },
});

// ---------------------------------------------------------------------------
// Update

/** Shared shape: apply an update op and report what happened. */
async function runUpdate(
  caller: McpCaller,
  entity: UpdateOp["entity"],
  id: string,
  patch: Record<string, unknown>,
  what: string,
) {
  if (Object.keys(patch).length === 0) {
    return { text: "Nothing to change: no fields were given.", data: { ok: false } };
  }
  const ctx = await contextFor(caller);
  const before = await applyUpdate(
    caller.userId,
    {
      op: "update" as const,
      entity,
      id,
      label: what,
      fields: patch,
      // The assistant fills `before` so its diff view can render old to new
      // without a re-fetch. Nothing renders a diff here, and applyUpdate reads
      // the current row itself to build the reversing patch, so an empty one
      // is correct rather than merely tolerated.
      before: {},
    } as UpdateOp,
    ctx,
  );
  await settle(caller, ctx);
  if (!before) {
    // The repository is scoped to this user, so a missing row and someone
    // else's row are the same answer, which is the answer they should be.
    return {
      text: `No ${entity} with id ${id}, or nothing changed.`,
      data: { ok: false },
    };
  }
  return {
    text: `Updated ${entity} ${id}. Changed: ${Object.keys(patch).join(", ")}.`,
    data: { ok: true, id, changed: Object.keys(patch) },
    entityIds: [id],
  };
}

/** Dropping a row is a delete, whichever tool asks for it. Usually it is a list sent short by mistake, so the refusal says how to keep them. */
function assertMayDropSubtasks(caller: McpCaller, removed: number): void {
  const keep =
    `This list leaves out ${removed} subtask${removed === 1 ? "" : "s"} already on the task, which would delete ${removed === 1 ? "it" : "them"}. ` +
    `To add, reorder or tick subtasks, send the whole list, including the ones to keep. ` +
    `A different title counts as a new subtask, so renaming one deletes the old one.`;
  try {
    assertScope({ scope: [...caller.scopes].join(" ") }, "delete");
    assertMcpAllowed(caller.settings, "delete");
  } catch (err) {
    if (err instanceof McpScopeError) {
      throw new McpScopeError(
        err.missing,
        `${keep} Really deleting needs this connection reconnected with the delete permission.`,
      );
    }
    throw new McpPolicyError(
      `${keep} Really deleting needs the account owner to allow it in PUMMA under Settings, Connections.`,
      "delete",
    );
  }
}

/** runUpdate plus the subtask list the call implies: the one given, or every box ticked when the task closes. */
async function runTaskUpdate(
  caller: McpCaller,
  id: string,
  patch: Record<string, unknown>,
  given?: SubtaskInput[],
) {
  const closing = patch.status === "done";
  if (!given && !closing) return runUpdate(caller, "task", id, patch, "task");

  const current = await getTask(caller.userId, id);
  if (!current) {
    return {
      text: `No task with id ${id}, or nothing changed.`,
      data: { ok: false },
    };
  }

  const list = given
    ? subtasksFromInput(given, current.subtasks)
    : tickedSubtasks(current.subtasks);
  const { added, removed } = subtaskChanges(current.subtasks, list);
  // Before anything is written.
  if (removed) assertMayDropSubtasks(caller, removed);

  // Straight to the row, since no metric reads subtasks; first, so nothing slow sits between that read and this write.
  const listChanged = !sameSubtasks(list, current.subtasks);
  if (listChanged) {
    const saved = await updateTaskRow(caller.userId, id, { subtasks: list });
    if (!saved) {
      return {
        text: `Could not save the subtasks on task ${id}.`,
        data: { ok: false },
        entityIds: [id],
      };
    }
  }

  // Already closed: done again would restamp the date, but a retry still has to repair the goal above it.
  const rest = { ...patch };
  if (closing && current.status === "done" && current.completedAt) {
    delete rest.status;
    if (current.projectId) {
      await syncGoalsForProject(caller.userId, current.projectId);
    }
  }
  if (Object.keys(rest).length) {
    const updated = await runUpdate(caller, "task", id, rest, "task");
    if (!updated.data.ok) return updated;
  }

  const changed = [...Object.keys(rest), ...(listChanged ? ["subtasks"] : [])];
  const counts = added || removed ? ` (${added} added, ${removed} removed)` : "";
  return {
    text: changed.length
      ? `Updated task ${id}. Changed: ${changed.join(", ")}${listChanged ? counts : ""}.`
      : `Task ${id} is already like that. Nothing changed.`,
    data: { ok: true, id, changed },
    entityIds: [id],
  };
}

export const updateTask = defineTool({
  name: "update_task",
  title: "Update a task",
  description:
    "Change a task. Only the fields you pass are touched. Setting status to done stamps the completion date unless the task is already closed, ticks its subtasks unless you send a list, and updates the project's progress.",
  opClass: "update",
  inputSchema: z.object({
    id: z.string(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    status: z.enum(["todo", "doing", "done"]).optional(),
    priority: z.enum(["low", "med", "high"]).optional(),
    due: isoDate.optional(),
    projectId: z.string().optional(),
    lifeArea: lifeArea.optional(),
    subtasks: subtasksField
      .optional()
      .describe(
        "Replaces the whole checklist, so send the items to keep too; get_task returns the current list. A title already on the task keeps its tick unless done says otherwise, ignoring case and outer spaces. Any other title is new and starts unticked. Leaving a subtask out removes it, which needs delete permission.",
      ),
  }),
  handler: async (input, caller) => {
    const { id, due, subtasks, ...rest } = input;
    return runTaskUpdate(
      caller,
      id,
      fields({ ...rest, date: due }),
      subtasks,
    );
  },
});

export const completeTask = defineTool({
  name: "complete_task",
  title: "Complete a task",
  description:
    "Mark a task done and tick its subtasks. Safe to call twice: a task that is already closed keeps its completion date.",
  opClass: "update",
  inputSchema: z.object({ id: z.string() }),
  handler: async (input, caller) =>
    runTaskUpdate(caller, input.id, { status: "done" }),
});

export const moveTask = defineTool({
  name: "move_task",
  title: "Move a task in its column",
  description:
    "Put a project task right below another one in the same project and status, or on top with after: null, as dragging a card on the board does. " +
    "Never changes a status: to move a task to another column, change its status with update_task first. " +
    "A task with no project has no order to change. list_tasks gives each project task its current position.",
  opClass: "update",
  inputSchema: z.object({
    id: z.string(),
    after: z
      .string()
      .nullable()
      .describe("Id of the task to go right below, or null for the top of the column."),
  }),
  handler: async ({ id, after }, caller) => {
    const refuse = (text: string) => ({ text, data: { ok: false } });
    const tasks = await listTasks(caller.userId);
    const task = tasks.find((t) => t.id === id);
    if (!task) return refuse(`No task with id ${id}.`);
    if (!task.projectId) {
      return refuse(`Task ${id} has no project, so it has no order to change.`);
    }
    if (after === id) return refuse(`Task ${id} can't go below itself.`);

    const column = columnOf(tasks, task.projectId, task.status);
    const ids = placeAfter(column.map((t) => t.id), id, after);
    if (!ids) {
      return refuse(
        `Task ${after} is not in the same project and status as task ${id}. A move never changes a status: change it with update_task first if that is what you want.`,
      );
    }

    const position = ids.indexOf(id) + 1;
    const note = boardNote(caller.settings);
    const reply = (text: string, changed: string[], touched = [id]) => ({
      text: note ? `${text} ${note}` : text,
      data: { ok: true, id, position, changed },
      entityIds: touched,
    });

    if (ids.every((rowId, i) => rowId === column[i].id)) {
      return reply(`Task ${id} is already there. Nothing changed.`, []);
    }
    // No goal sync: order feeds no metric.
    const patches = orderPatches(column, ids);
    await updateTasks(caller.userId, patches);
    return reply(
      after
        ? `Moved task ${id} below ${after}, to position ${position} in its column.`
        : `Moved task ${id} to the top of its column.`,
      ["order"],
      [...new Set([id, ...patches.map((p) => p.id)])],
    );
  },
});

export const updateNote = defineTool({
  name: "update_note",
  title: "Update a note",
  description: "Change a note's title or body.",
  opClass: "update",
  inputSchema: z.object({
    id: z.string(),
    title: z.string().min(1).max(200).optional(),
    body: z.string().max(20000).optional(),
    lifeArea: lifeArea.optional(),
  }),
  handler: async (input, caller) =>
    runUpdate(
      caller,
      "note",
      input.id,
      fields({
        title: input.title,
        description: input.body,
        lifeArea: input.lifeArea,
      }),
      "note",
    ),
});

export const updateProject = defineTool({
  name: "update_project",
  title: "Update a project",
  description: "Change a project's title, description, or the goal above it.",
  opClass: "update",
  inputSchema: z.object({
    id: z.string(),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    goalId: z.string().optional(),
    lifeArea: lifeArea.optional(),
  }),
  handler: async (input, caller) => {
    const { id, ...rest } = input;
    return runUpdate(caller, "project", id, fields(rest), "project");
  },
});

export const updateGoal = defineTool({
  name: "update_goal",
  title: "Update a goal",
  description:
    "Change a goal's title or target date. Progress is derived from the work underneath, so it cannot be set here.",
  opClass: "update",
  inputSchema: z.object({
    id: z.string(),
    title: z.string().min(1).max(200).optional(),
    targetDate: isoDate.optional(),
    lifeArea: lifeArea.optional(),
  }),
  handler: async (input, caller) =>
    runUpdate(
      caller,
      "goal",
      input.id,
      fields({
        title: input.title,
        date: input.targetDate,
        lifeArea: input.lifeArea,
      }),
      "goal",
    ),
});

export const updateHabit = defineTool({
  name: "update_habit",
  title: "Update a habit",
  description: "Rename a habit, change how often it repeats, or archive it.",
  opClass: "update",
  inputSchema: z.object({
    id: z.string(),
    name: z.string().min(1).max(200).optional(),
    frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
    archived: z.boolean().optional(),
    lifeArea: lifeArea.optional(),
  }),
  handler: async (input, caller) =>
    runUpdate(
      caller,
      "habit",
      input.id,
      fields({
        title: input.name,
        frequency: input.frequency,
        archived: input.archived,
        lifeArea: input.lifeArea,
      }),
      "habit",
    ),
});

export const updateMeeting = defineTool({
  name: "update_meeting",
  title: "Update a meeting",
  description:
    "Change a meeting on the user's own agenda. Events mirrored from a subscribed calendar are read-only and cannot be changed here; unsubscribe or edit them where they live.",
  opClass: "update",
  inputSchema: z.object({
    id: z.string(),
    title: z.string().min(1).max(200).optional(),
    date: isoDate.optional(),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, 24 hour")
      .optional(),
    durationMins: z.number().int().min(5).max(600).optional(),
    notes: z.string().max(1000).optional(),
    lifeArea: lifeArea.optional(),
  }),
  handler: async (input, caller) => {
    const { id, notes, ...rest } = input;
    // No explicit check for a mirrored event is needed, and adding one would
    // be a second rule to keep in step. The mutation layer looks the meeting
    // up in the user's own agenda; a synced event lives in a different
    // collection entirely, so it is simply not found and reports as such.
    return runUpdate(
      caller,
      "meeting",
      id,
      fields({ ...rest, description: notes }),
      "meeting",
    );
  },
});

export const logHabit = defineTool({
  name: "log_habit",
  title: "Log a habit",
  description:
    "Mark a habit as done on a date (today by default). Idempotent: logging the same day twice leaves it done once.",
  opClass: "update",
  inputSchema: z.object({
    id: z.string().describe("Habit id, from list_habits."),
    date: isoDate.optional().describe("Defaults to today in the user's timezone."),
  }),
  handler: async (input, caller) => {
    const date = input.date ?? isoDateInTz(new Date(), caller.timeZone);
    const habits = await listHabits(caller.userId);
    const habit = habits.find((h) => h.id === input.id);
    if (!habit) {
      return { text: `No habit with id ${input.id}.`, data: { ok: false } };
    }
    // markHabitEntry rather than toggle: a tool that flips state is a trap for
    // a caller that retries. Asked to log a habit twice, the honest outcome is
    // a habit that is logged, not one that has been un-logged.
    await markHabitEntry(caller.userId, input.id, date);
    return {
      text: `Logged "${habit.name}" for ${date}.`,
      data: { ok: true, id: input.id, date },
      entityIds: [input.id],
    };
  },
});

export const setGoalProgress = defineTool({
  name: "set_goal_progress",
  title: "Set goal progress",
  description:
    "Set a goal's progress percentage directly, for goals not tracked through projects and tasks.",
  opClass: "update",
  inputSchema: z.object({
    id: z.string(),
    progress: z.number().int().min(0).max(100).describe("0 to 100."),
  }),
  handler: async (input, caller) => {
    const goals = await listGoals(caller.userId);
    const goal = goals.find((g) => g.id === input.id);
    if (!goal) {
      return { text: `No goal with id ${input.id}.`, data: { ok: false } };
    }
    // An absolute value, not a delta like the UI's own control. A tool call
    // that retries must not add its increment twice, and a model asked for
    // "60 percent" should not have to know what it was before.
    await updateGoalRow(caller.userId, input.id, { progress: input.progress });
    return {
      text: `"${goal.title}" is now at ${input.progress}%.`,
      data: { ok: true, id: input.id, progress: input.progress },
      entityIds: [input.id],
    };
  },
});
