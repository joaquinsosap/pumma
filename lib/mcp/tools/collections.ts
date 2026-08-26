/**
 * Read tools for the rest of the workspace: projects, goals, habits, notes,
 * and one task in full.
 *
 * Same two rules as the other read tools. Everything goes through the
 * repository layer, so per-user scoping and decryption are already handled.
 * Everything is capped, because a tool that can return the whole workspace
 * will, and the caller pays for it in context.
 */
import "server-only";
import * as z from "zod/v4";
import { defineTool } from "@/lib/mcp/registry";
import { getTask } from "@/lib/db/tasks";
import { listTasks } from "@/lib/db/tasks";
import { listProjects } from "@/lib/db/projects";
import { listGoals } from "@/lib/db/goals";
import { listHabits } from "@/lib/db/habits";
import { listHabitEntries } from "@/lib/db/habitEntries";
import { listNotes } from "@/lib/db/notes";
import { listTags } from "@/lib/db/tags";
import { streakOf } from "@/lib/date";
import { isoDateInTz } from "@/lib/timezone";

const MAX_LIMIT = 200;

const limitField = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(50)
  .describe(`How many to return. Max ${MAX_LIMIT}.`);

export const getTaskTool = defineTool({
  name: "get_task",
  title: "Task detail",
  description:
    "One task in full: description, subtasks, tags, time tracked. " +
    "Use list_tasks first to find the id.",
  opClass: "read",
  inputSchema: z.object({
    id: z.string().describe("Task id, as returned by list_tasks."),
  }),
  handler: async (input, caller) => {
    const task = await getTask(caller.userId, input.id);
    // The repository is already scoped to this user, so "not found" and
    // "belongs to somebody else" are the same answer here, which is the
    // answer they should be.
    if (!task) {
      return { text: `No task with id ${input.id}.`, data: { found: false } };
    }
    const tags = await listTags(caller.userId);
    const names = new Map(tags.map((t) => [t.id, t.name]));

    const lines = [
      `${task.title}`,
      `id ${task.id} - ${task.status} - ${task.priority} priority`,
      task.due ? `due ${task.due}` : "no due date",
    ];
    if (task.description) lines.push("", task.description);
    if (task.subtasks.length) {
      lines.push("", "Subtasks:");
      for (const s of task.subtasks) {
        lines.push(`  [${s.done ? "x" : " "}] ${s.title}`);
      }
    }
    const tagNames = task.tagIds.map((id) => names.get(id)).filter(Boolean);
    if (tagNames.length) lines.push("", `Tags: ${tagNames.join(", ")}`);
    if (task.timeSpentSec > 0) {
      lines.push(`Time tracked: ${Math.round(task.timeSpentSec / 60)} min`);
    }

    return {
      text: lines.join("\n"),
      data: {
        found: true,
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        due: task.due,
        projectId: task.projectId,
        goalId: task.goalId,
        lifeArea: task.lifeArea,
        tags: tagNames,
        subtasks: task.subtasks.map((s) => ({ title: s.title, done: s.done })),
        timeSpentSec: task.timeSpentSec,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
      },
      entityIds: [task.id],
    };
  },
});

export const listProjectsTool = defineTool({
  name: "list_projects",
  title: "List projects",
  description: "The user's projects, with progress and how many tasks each holds.",
  opClass: "read",
  inputSchema: z.object({
    lifeArea: z.enum(["personal", "work", "both"]).optional(),
    limit: limitField,
  }),
  handler: async (input, caller) => {
    const [projects, tasks] = await Promise.all([
      listProjects(caller.userId),
      listTasks(caller.userId),
    ]);
    let rows = projects;
    if (input.lifeArea) rows = rows.filter((p) => p.lifeArea === input.lifeArea);
    const page = rows.slice(0, input.limit);

    const counts = new Map<string, { open: number; total: number }>();
    for (const t of tasks) {
      if (!t.projectId) continue;
      const c = counts.get(t.projectId) ?? { open: 0, total: 0 };
      c.total += 1;
      if (t.status !== "done") c.open += 1;
      counts.set(t.projectId, c);
    }

    const lines = page.map((p) => {
      const c = counts.get(p.id) ?? { open: 0, total: 0 };
      return `${p.id}  ${p.title} (${p.progress}%, ${c.open}/${c.total} tasks open)`;
    });

    return {
      text: [`${rows.length} project${rows.length === 1 ? "" : "s"}:`, ...lines.map((l) => `  ${l}`)].join("\n"),
      data: {
        total: rows.length,
        projects: page.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          progress: p.progress,
          goalId: p.goalId,
          lifeArea: p.lifeArea,
          openTasks: counts.get(p.id)?.open ?? 0,
          totalTasks: counts.get(p.id)?.total ?? 0,
        })),
      },
      entityIds: page.map((p) => p.id),
    };
  },
});

export const listGoalsTool = defineTool({
  name: "list_goals",
  title: "List goals",
  description:
    "The user's goals with progress. Progress is derived from the projects, tasks and habits underneath a goal, so it is not set directly.",
  opClass: "read",
  inputSchema: z.object({
    category: z.enum(["personal", "work"]).optional(),
    limit: limitField,
  }),
  handler: async (input, caller) => {
    let rows = await listGoals(caller.userId);
    if (input.category) rows = rows.filter((g) => g.category === input.category);
    const page = rows.slice(0, input.limit);

    return {
      text: [
        `${rows.length} goal${rows.length === 1 ? "" : "s"}:`,
        ...page.map(
          (g) =>
            `  ${g.id}  ${g.title} (${g.progress}%${g.targetDate ? `, target ${g.targetDate}` : ""})`,
        ),
      ].join("\n"),
      data: {
        total: rows.length,
        goals: page.map((g) => ({
          id: g.id,
          title: g.title,
          category: g.category,
          progress: g.progress,
          metricLabel: g.metricLabel,
          targetDate: g.targetDate,
        })),
      },
      entityIds: page.map((g) => g.id),
    };
  },
});

export const listHabitsTool = defineTool({
  name: "list_habits",
  title: "List habits",
  description:
    "The user's habits with their current streak and whether each is done today.",
  opClass: "read",
  inputSchema: z.object({
    includeArchived: z.boolean().default(false),
    limit: limitField,
  }),
  handler: async (input, caller) => {
    const today = isoDateInTz(new Date(), caller.timeZone);
    const [habits, entries] = await Promise.all([
      listHabits(caller.userId),
      listHabitEntries(caller.userId),
    ]);

    const byHabit = new Map<string, Set<string>>();
    for (const e of entries) {
      if (!e.done) continue;
      const set = byHabit.get(e.habitId) ?? new Set<string>();
      set.add(e.date.slice(0, 10));
      byHabit.set(e.habitId, set);
    }

    let rows = habits;
    if (!input.includeArchived) rows = rows.filter((h) => !h.archived);
    const page = rows.slice(0, input.limit);

    const described = page.map((h) => {
      const dates = byHabit.get(h.id) ?? new Set<string>();
      return {
        id: h.id,
        name: h.name,
        frequency: h.frequency.type,
        target: h.frequency.target,
        archived: Boolean(h.archived),
        doneToday: dates.has(today),
        streak: streakOf(dates, today, caller.timeZone),
      };
    });

    return {
      text: [
        `${rows.length} habit${rows.length === 1 ? "" : "s"} (today is ${today}):`,
        ...described.map(
          (h) =>
            `  ${h.id}  ${h.name} - ${h.frequency} - streak ${h.streak}${h.doneToday ? " - done today" : ""}`,
        ),
      ].join("\n"),
      data: { total: rows.length, habits: described },
      entityIds: page.map((h) => h.id),
    };
  },
});

export const listNotesTool = defineTool({
  name: "list_notes",
  title: "List notes",
  description:
    "The user's notes. Bodies are truncated in the summary; ask for a specific note by narrowing the query.",
  opClass: "read",
  inputSchema: z.object({
    query: z
      .string()
      .max(200)
      .optional()
      .describe("Case-insensitive match on title or body."),
    pinnedOnly: z.boolean().default(false),
    limit: limitField,
  }),
  handler: async (input, caller) => {
    let rows = await listNotes(caller.userId);
    if (input.pinnedOnly) rows = rows.filter((n) => n.pinned);
    if (input.query) {
      const needle = input.query.toLowerCase();
      rows = rows.filter(
        (n) =>
          n.title.toLowerCase().includes(needle) ||
          n.body.toLowerCase().includes(needle),
      );
    }
    const page = rows.slice(0, input.limit);

    return {
      text: [
        `${rows.length} note${rows.length === 1 ? "" : "s"}:`,
        ...page.map((n) => {
          const preview = n.body.replace(/\s+/g, " ").slice(0, 120);
          return `  ${n.id}  ${n.title || "(untitled)"}${n.pinned ? " [pinned]" : ""}${preview ? ` - ${preview}` : ""}`;
        }),
      ].join("\n"),
      data: {
        total: rows.length,
        notes: page.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          pinned: n.pinned,
          lifeArea: n.lifeArea,
          updatedAt: n.updatedAt,
        })),
      },
      entityIds: page.map((n) => n.id),
    };
  },
});
