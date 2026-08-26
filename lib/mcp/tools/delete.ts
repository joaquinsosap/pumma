/**
 * Delete tools.
 *
 * Two things stand between a model and someone's data here, and they are
 * independent on purpose. The token must carry `pumma:delete`, which the user
 * granted that specific client when they connected it. And the account must
 * currently allow deletes, which is a switch that is off by default and takes
 * effect on the next request. Both are checked in the registry wrapper, so
 * nothing in this file has to remember to.
 *
 * Deletes are not undoable. The assistant's changeset has the same property
 * and answers it with a confirmation screen the user reads before applying.
 * There is no screen here, so the answers are: the switch is off unless
 * someone turns it on, every tool is annotated destructive so a well-behaved
 * client asks first, and deleting a project (which takes its tasks with it)
 * needs a second call that names what will be lost.
 */
import "server-only";
import * as z from "zod/v4";
import { defineTool } from "@/lib/mcp/registry";
import { applyDelete } from "@/lib/mutations/entities";
import { listTasks } from "@/lib/db/tasks";
import { listProjects } from "@/lib/db/projects";
import { listNotes } from "@/lib/db/notes";
import { listGoals } from "@/lib/db/goals";
import { listHabits } from "@/lib/db/habits";
import { listAgenda } from "@/lib/db/agenda";
import { syncGoalsForProject } from "@/lib/goal-sync-server";
import { stageDelete, redeemDelete, CONFIRM_TTL_MINUTES } from "@/lib/mcp/confirm";
import type { McpCaller } from "@/lib/mcp/context";
import type { ChangeEntity } from "@/lib/ai/changeset-schema";

/** Delete one row after checking it exists and belongs to this account. */
async function removeSimple(
  caller: McpCaller,
  entity: ChangeEntity,
  id: string,
  found: boolean,
  label: string,
) {
  if (!found) {
    // Repositories are user-scoped, so "no such row" and "someone else's row"
    // are the same answer, which is the answer they should be.
    return { text: `No ${entity} with id ${id}.`, data: { ok: false } };
  }
  const touched = new Set<string>();
  await applyDelete(caller.userId, entity, id, touched);
  for (const projectId of touched) {
    await syncGoalsForProject(caller.userId, projectId);
  }
  return {
    text: `Deleted ${entity} "${label}". This cannot be undone.`,
    data: { ok: true, id },
    entityIds: [id],
  };
}

export const deleteTask = defineTool({
  name: "delete_task",
  title: "Delete a task",
  description: "Permanently delete a task. This cannot be undone.",
  opClass: "delete",
  inputSchema: z.object({ id: z.string() }),
  handler: async (input, caller) => {
    const row = (await listTasks(caller.userId)).find((t) => t.id === input.id);
    return removeSimple(caller, "task", input.id, Boolean(row), row?.title ?? "");
  },
});

export const deleteNote = defineTool({
  name: "delete_note",
  title: "Delete a note",
  description: "Permanently delete a note. This cannot be undone.",
  opClass: "delete",
  inputSchema: z.object({ id: z.string() }),
  handler: async (input, caller) => {
    const row = (await listNotes(caller.userId)).find((n) => n.id === input.id);
    return removeSimple(caller, "note", input.id, Boolean(row), row?.title ?? "");
  },
});

export const deleteGoal = defineTool({
  name: "delete_goal",
  title: "Delete a goal",
  description:
    "Permanently delete a goal. Projects and habits under it survive; they simply stop being linked to it.",
  opClass: "delete",
  inputSchema: z.object({ id: z.string() }),
  handler: async (input, caller) => {
    const row = (await listGoals(caller.userId)).find((g) => g.id === input.id);
    return removeSimple(caller, "goal", input.id, Boolean(row), row?.title ?? "");
  },
});

export const deleteHabit = defineTool({
  name: "delete_habit",
  title: "Delete a habit",
  description:
    "Permanently delete a habit and its history. To keep the history, update it with archived instead.",
  opClass: "delete",
  inputSchema: z.object({ id: z.string() }),
  handler: async (input, caller) => {
    const row = (await listHabits(caller.userId)).find((h) => h.id === input.id);
    return removeSimple(caller, "habit", input.id, Boolean(row), row?.name ?? "");
  },
});

export const deleteMeeting = defineTool({
  name: "delete_meeting",
  title: "Delete a meeting",
  description:
    "Permanently delete a meeting from the user's own agenda. Events mirrored from a subscribed calendar cannot be deleted here; unsubscribe from the feed instead.",
  opClass: "delete",
  inputSchema: z.object({ id: z.string() }),
  handler: async (input, caller) => {
    // listAgenda holds only the user's own meetings, so a synced event is
    // simply not found. No separate rule to keep in step.
    const row = (await listAgenda(caller.userId)).find((a) => a.id === input.id);
    return removeSimple(caller, "meeting", input.id, Boolean(row), row?.title ?? "");
  },
});

export const deleteProject = defineTool({
  name: "delete_project",
  title: "Delete a project",
  description:
    "Permanently delete a project AND every task filed under it. " +
    "Two steps: call it once without a confirm value to see exactly what would be lost, " +
    "then call it again with the confirm value from that reply. " +
    "Tell the user what the first call reported before making the second.",
  opClass: "delete",
  inputSchema: z.object({
    id: z.string(),
    confirm: z
      .string()
      .optional()
      .describe(
        "The confirm value returned by the first call. Omit it to preview.",
      ),
  }),
  handler: async (input, caller) => {
    const project = (await listProjects(caller.userId)).find(
      (p) => p.id === input.id,
    );
    if (!project) {
      return { text: `No project with id ${input.id}.`, data: { ok: false } };
    }
    const tasks = (await listTasks(caller.userId)).filter(
      (t) => t.projectId === input.id,
    );
    const summary =
      `project "${project.title}"` +
      (tasks.length
        ? ` and its ${tasks.length} task${tasks.length === 1 ? "" : "s"}`
        : " (no tasks filed under it)");

    if (!input.confirm) {
      const handle = await stageDelete(caller.userId, {
        entity: "project",
        id: input.id,
        summary,
      });
      const lines = [
        `This would permanently delete ${summary}. It cannot be undone.`,
      ];
      if (tasks.length) {
        lines.push("", "Tasks that would go with it:");
        for (const t of tasks.slice(0, 20)) lines.push(`  ${t.title}`);
        if (tasks.length > 20) lines.push(`  ...and ${tasks.length - 20} more`);
      }
      lines.push(
        "",
        `Show this to the user. To go ahead, call delete_project again with confirm: "${handle}" (valid ${CONFIRM_TTL_MINUTES} minutes).`,
      );
      return {
        text: lines.join("\n"),
        data: {
          ok: false,
          confirmRequired: true,
          confirm: handle,
          project: project.title,
          taskCount: tasks.length,
          tasks: tasks.slice(0, 20).map((t) => t.title),
        },
        entityIds: [input.id],
      };
    }

    const redeemed = await redeemDelete(caller.userId, input.confirm, {
      entity: "project",
      id: input.id,
    });
    if (!redeemed.ok) {
      return {
        text:
          `That confirm value is ${redeemed.reason}. ` +
          `Call delete_project without confirm to see what would be deleted and get a fresh one.`,
        data: { ok: false, reason: redeemed.reason },
      };
    }

    const touched = new Set<string>();
    await applyDelete(caller.userId, "project", input.id, touched);
    return {
      text: `Deleted ${summary}. This cannot be undone.`,
      data: { ok: true, id: input.id, deletedTasks: tasks.length },
      entityIds: [input.id, ...tasks.map((t) => t.id)],
    };
  },
});
