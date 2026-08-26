/**
 * The read tools.
 *
 * Two rules hold across all of them.
 *
 * Everything goes through the repository layer, never at Mongo directly. Above
 * `lib/db/mongo/*` the per-user encryption is transparent and every query is
 * already scoped to a userId; below it, titles and note bodies are ciphertext.
 * The account export learned this the hard way and shipped a file full of
 * "v1:..." strings.
 *
 * Everything is capped. A tool that can return a whole workspace will, and the
 * caller pays for it in context. The caps are the same 200 the assistant's
 * bulk path uses, so the two funnels do not disagree about what "all" means.
 */
import "server-only";
import * as z from "zod/v4";
import { defineTool } from "@/lib/mcp/registry";
import { listTasks } from "@/lib/db/tasks";
import { listProjects } from "@/lib/db/projects";
import { listGoals } from "@/lib/db/goals";
import { listHabits } from "@/lib/db/habits";
import { listNotes } from "@/lib/db/notes";
import { isOverdue } from "@/lib/task-filters";
import { isoDateInTz } from "@/lib/timezone";
import type { Task } from "@/lib/schemas";

/** Matches ALL_CAP in the scope resolver and bulkUpdateTasks' own ceiling. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 25;

const limitField = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(DEFAULT_LIMIT)
  .describe(`How many to return. Max ${MAX_LIMIT}.`);

/** One task, flattened to what a model can actually use. */
function taskLine(t: Task, today: string): string {
  const bits = [t.title];
  if (t.status !== "todo") bits.push(`[${t.status}]`);
  if (t.priority !== "med") bits.push(`(${t.priority} priority)`);
  if (t.due) bits.push(isOverdue(t, today) ? `due ${t.due} OVERDUE` : `due ${t.due}`);
  return `${t.id}  ${bits.join(" ")}`;
}

export const getOverview = defineTool({
  name: "get_overview",
  title: "Overview",
  description:
    "A summary of the user's PUMMA workspace: counts, what is due today, what is overdue. " +
    "Call this first to orient yourself instead of listing every collection.",
  opClass: "read",
  inputSchema: z.object({}),
  handler: async (_input, caller) => {
    const today = isoDateInTz(new Date(), caller.timeZone);
    const [tasks, projects, goals, habits, notes] = await Promise.all([
      listTasks(caller.userId),
      listProjects(caller.userId),
      listGoals(caller.userId),
      listHabits(caller.userId),
      listNotes(caller.userId),
    ]);

    const open = tasks.filter((t) => t.status !== "done");
    const overdue = open.filter((t) => isOverdue(t, today));
    const dueToday = open.filter((t) => (t.due ?? "").slice(0, 10) === today);

    const lines = [
      `PUMMA workspace (timezone ${caller.timeZone}, today is ${today})`,
      `Tasks: ${tasks.length} total, ${open.length} open, ${overdue.length} overdue, ${dueToday.length} due today`,
      `Projects: ${projects.length}   Goals: ${goals.length}   Habits: ${habits.length}   Notes: ${notes.length}`,
    ];
    if (overdue.length) {
      lines.push("", "Overdue:");
      for (const t of overdue.slice(0, 10)) lines.push(`  ${taskLine(t, today)}`);
      if (overdue.length > 10) lines.push(`  ...and ${overdue.length - 10} more`);
    }
    if (dueToday.length) {
      lines.push("", "Due today:");
      for (const t of dueToday.slice(0, 10)) lines.push(`  ${taskLine(t, today)}`);
      if (dueToday.length > 10) lines.push(`  ...and ${dueToday.length - 10} more`);
    }

    return {
      text: lines.join("\n"),
      data: {
        today,
        timeZone: caller.timeZone,
        counts: {
          tasks: tasks.length,
          openTasks: open.length,
          overdue: overdue.length,
          dueToday: dueToday.length,
          projects: projects.length,
          goals: goals.length,
          habits: habits.length,
          notes: notes.length,
        },
      },
    };
  },
});

export const listTasksTool = defineTool({
  name: "list_tasks",
  title: "List tasks",
  description:
    "List the user's tasks, with optional filters. " +
    "Ids returned here are what every other task tool expects. " +
    "Note that 'overdue' means past its due date AND not done: a finished task with an old date is history, not a debt.",
  opClass: "read",
  inputSchema: z.object({
    status: z
      .array(z.enum(["todo", "doing", "done"]))
      .optional()
      .describe("Empty or omitted means any status."),
    priority: z
      .array(z.enum(["low", "med", "high"]))
      .optional(),
    overdue: z.boolean().optional().describe("Only tasks past their due date and not done."),
    dueBefore: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("ISO date, exclusive."),
    query: z.string().max(200).optional().describe("Case-insensitive match on the title."),
    projectId: z.string().optional(),
    limit: limitField,
  }),
  handler: async (input, caller) => {
    const today = isoDateInTz(new Date(), caller.timeZone);
    let rows = await listTasks(caller.userId);

    if (input.status?.length) rows = rows.filter((t) => input.status!.includes(t.status));
    if (input.priority?.length) {
      rows = rows.filter((t) => input.priority!.includes(t.priority));
    }
    if (input.overdue) rows = rows.filter((t) => isOverdue(t, today));
    if (input.dueBefore) {
      rows = rows.filter((t) => {
        const d = (t.due ?? "").slice(0, 10);
        return d.length > 0 && d < input.dueBefore!;
      });
    }
    if (input.projectId) rows = rows.filter((t) => t.projectId === input.projectId);
    if (input.query) {
      const needle = input.query.toLowerCase();
      rows = rows.filter((t) => t.title.toLowerCase().includes(needle));
    }

    const total = rows.length;
    const page = rows.slice(0, input.limit);
    const header =
      total > page.length
        ? `${page.length} of ${total} matching tasks (raise limit to see more):`
        : `${total} matching task${total === 1 ? "" : "s"}:`;

    return {
      text: [header, ...page.map((t) => `  ${taskLine(t, today)}`)].join("\n"),
      data: {
        total,
        returned: page.length,
        tasks: page.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          due: t.due ?? null,
          projectId: t.projectId ?? null,
          overdue: isOverdue(t, today),
        })),
      },
      entityIds: page.map((t) => t.id),
    };
  },
});
