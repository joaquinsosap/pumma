"use server";

// The unified assistant's server half: run a request, preview a draft against
// live data, apply it, undo it. The apply engine executes typed ops in
// dependency order; creates and updates are undoable for the session, deletes
// are guarded by the confirmation step instead (resurrecting a deleted row
// with its old id is a can of worms this deliberately stays out of).
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types";
import { requireUserId } from "@/lib/auth/session";
import {
  deleteAgendaItem,
  listAgenda,
  updateAgendaItem,
} from "@/lib/db/agenda";
import { userToday } from "@/lib/timezone-server";
import { AI_QUOTA_MESSAGE, reserveAiCall } from "@/lib/ai/quota";
import { aiInput } from "@/lib/validation";
import {
  changesetSchema,
  type Changeset,
  type ChangeEntity,
} from "@/lib/ai/changeset-schema";
import { listGoals, updateGoal, deleteGoal } from "@/lib/db/goals";
import { listProjects, updateProject, deleteProject } from "@/lib/db/projects";
import { listHabits, updateHabit, deleteHabit } from "@/lib/db/habits";
import { listTasks, updateTask, deleteTask } from "@/lib/db/tasks";
import { listNotes, updateNote, deleteNote } from "@/lib/db/notes";
import { listTags } from "@/lib/db/tags";
import { syncGoalsForProject } from "@/lib/goal-sync-server";
import {
  applyCreate,
  applyUpdate,
  applyDelete,
} from "@/lib/mutations/entities";

// ---------------------------------------------------------------------------
// Node-scoped reprompt: regenerate one subtree, leave the rest untouched.

export async function repromptNodeAction(input: {
  /** The original request, for context. */
  intent: string;
  /** The user's instruction for this node. */
  instruction: string;
  /** The ops forming the subtree being rewritten (node + its children). */
  subtree: Changeset["ops"];
  /** Labels of sibling/parent nodes, so renames don't collide blindly. */
  context: string[];
}): Promise<ActionResult<Changeset["ops"]>> {
  const instruction = aiInput.safeParse(input.instruction);
  if (!instruction.success) {
    return {
      ok: false,
      error: "Say what should change (3 to 2000 characters).",
    };
  }
  const userId = await requireUserId();
  if (!(await reserveAiCall(userId))) {
    return { ok: false, error: AI_QUOTA_MESSAGE };
  }

  const { repromptSubtree } = await import("@/lib/ai/assist");
  try {
    return {
      ok: true,
      data: await repromptSubtree(userId, {
        intent: input.intent,
        instruction: instruction.data,
        subtree: input.subtree,
        context: input.context,
      }),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "The rewrite failed.",
    };
  }
}

// ---------------------------------------------------------------------------
// Preview: stale checks + delete blast radius, against live data

export type OpProblem = {
  /** Index into the changeset's ops array. */
  index: number;
  message: string;
};

export type DeleteRadius = {
  index: number;
  label: string;
  entity: ChangeEntity;
  /** What goes with it — for projects, the tasks inside. */
  also: string[];
};

export async function previewChangesetAction(raw: Changeset): Promise<
  ActionResult<{
    problems: OpProblem[];
    deletes: DeleteRadius[];
    /** id → display name, so a parentRef diff reads as a name not a hex id. */
    names: Record<string, string>;
  }>
> {
  const parsed = changesetSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid changeset." };
  const userId = await requireUserId();

  const existing = await liveIds(userId);
  const tasks = await listTasks(userId);

  const problems: OpProblem[] = [];
  const deletes: DeleteRadius[] = [];

  parsed.data.ops.forEach((op, index) => {
    if (op.op === "create") return;
    if (!existing[op.entity].has(op.id)) {
      problems.push({
        index,
        message: `"${op.label}" no longer exists, because it changed since this draft was made.`,
      });
      return;
    }
    if (op.op === "update" && !Object.keys(op.fields).length) {
      // A no-op update is always a modelling mistake, and in a merge it's the
      // dangerous kind: it looks like the work moved when it didn't.
      problems.push({
        index,
        message: `"${op.label}" has no changes, so this operation would do nothing.`,
      });
      return;
    }
    if (op.op === "delete") {
      const also =
        op.entity === "project"
          ? tasks.filter((t) => t.projectId === op.id).map((t) => t.title)
          : [];
      deletes.push({ index, label: op.label, entity: op.entity, also });
    }
  });

  // Any id the draft mentions — as an op target or a parentRef — gets a name.
  const [goals, projects, habits, notes] = await Promise.all([
    listGoals(userId),
    listProjects(userId),
    listHabits(userId),
    listNotes(userId),
  ]);
  const names: Record<string, string> = {};
  for (const g of goals) names[g.id] = g.title;
  for (const p of projects) names[p.id] = p.title;
  for (const h of habits) names[h.id] = h.name;
  for (const t of tasks) names[t.id] = t.title;
  for (const n of notes) names[n.id] = n.title;

  return { ok: true, data: { problems, deletes, names } };
}

// ---------------------------------------------------------------------------
// Apply

export type UndoPayloadV2 = {
  created: { entity: ChangeEntity; id: string }[];
  updated: {
    entity: ChangeEntity;
    id: string;
    before: Record<string, unknown>;
  }[];
};

export type ApplyChangesetResult = {
  applied: number;
  skipped: { label: string; reason: string }[];
  /** For the "open it" links in the applied view. */
  created: { entity: ChangeEntity; id: string; title: string }[];
  undo: UndoPayloadV2;
};

export async function applyChangesetAction(
  raw: Changeset,
): Promise<ActionResult<ApplyChangesetResult>> {
  const parsed = changesetSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid changeset." };
  const userId = await requireUserId();
  const { today: td } = await userToday();

  const existing = await liveIds(userId);
  const tags = await listTags(userId);

  const skipped: ApplyChangesetResult["skipped"] = [];
  const created: ApplyChangesetResult["created"] = [];
  const undo: UndoPayloadV2 = { created: [], updated: [] };
  const idByRef = new Map<string, string>();
  const touchedProjects = new Set<string>();

  // A *Ref is a refId minted in this changeset, or a real id that must exist.
  const resolve = (entity: ChangeEntity, ref?: string | null): string | null =>
    ref ? (idByRef.get(ref) ?? (existing[entity].has(ref) ? ref : null)) : null;

  // Creates parent-first, then updates, then deletes last — a merge's delete
  // must not run before the updates that empty the container.
  const order = { create: 0, update: 1, delete: 2 } as const;
  const entityOrder: Record<ChangeEntity, number> = {
    goal: 0,
    project: 1,
    habit: 2,
    task: 3,
    note: 4,
    meeting: 5,
  };
  const ops = [...parsed.data.ops].sort(
    (a, b) =>
      order[a.op] - order[b.op] ||
      entityOrder[a.entity] - entityOrder[b.entity],
  );

  let applied = 0;
  try {
    for (const op of ops) {
      if (op.op === "create") {
        const id = await applyCreate(userId, op, {
          td,
          tags,
          resolve,
          touchedProjects,
        });
        if (id) {
          idByRef.set(op.refId, id.id);
          created.push({ entity: op.entity, id: id.id, title: id.title });
          undo.created.push({ entity: op.entity, id: id.id });
          applied++;
        }
        continue;
      }

      // Stale guard: apply never touches an id that no longer exists.
      if (!existing[op.entity].has(op.id)) {
        skipped.push({ label: op.label, reason: "no longer exists" });
        continue;
      }

      if (op.op === "update") {
        if (!Object.keys(op.fields).length) {
          skipped.push({ label: op.label, reason: "had no changes" });
          continue;
        }
        const before = await applyUpdate(userId, op, {
          td,
          tags,
          resolve,
          touchedProjects,
        });
        if (before) {
          undo.updated.push({ entity: op.entity, id: op.id, before });
          applied++;
        } else {
          skipped.push({ label: op.label, reason: "could not be updated" });
        }
        continue;
      }

      await applyDelete(userId, op.entity, op.id, touchedProjects);
      applied++;
    }

    for (const projectId of touchedProjects) {
      await syncGoalsForProject(userId, projectId);
    }
  } catch {
    return {
      ok: false,
      error: `Applied ${applied} of ${ops.length} operations, then hit an error. Check what exists before retrying.`,
    };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { applied, skipped, created, undo } };
}

// ---------------------------------------------------------------------------
// Undo: remove what was created, restore what was changed. Session-scoped.

export async function undoChangesetAction(
  undo: UndoPayloadV2,
): Promise<ActionResult<{ reverted: number }>> {
  const userId = await requireUserId();
  let reverted = 0;

  // Reverse order: restore updates first, then remove creations (children
  // before parents — creations were parent-first, so reversing suffices).
  for (const u of [...undo.updated].reverse()) {
    const fn = {
      goal: updateGoal,
      project: updateProject,
      habit: updateHabit,
      task: updateTask,
      note: updateNote,
      meeting: updateAgendaItem,
    }[u.entity] as (
      uid: string,
      id: string,
      patch: Record<string, unknown>,
    ) => Promise<unknown>;
    if (await fn(userId, u.id, u.before)) reverted++;
  }
  for (const c of [...undo.created].reverse()) {
    const ok = await {
      goal: deleteGoal,
      project: (uid: string, id: string) =>
        deleteProject(uid, id, { deleteTasks: false }),
      habit: deleteHabit,
      task: deleteTask,
      note: deleteNote,
      meeting: deleteAgendaItem,
    }[c.entity](userId, c.id);
    if (ok) reverted++;
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { reverted } };
}

// ---------------------------------------------------------------------------
// The per-entity engine

async function liveIds(
  userId: string,
): Promise<Record<ChangeEntity, Set<string>>> {
  const [goals, projects, habits, tasks, notes, agenda] = await Promise.all([
    listGoals(userId),
    listProjects(userId),
    listHabits(userId),
    listTasks(userId),
    listNotes(userId),
    listAgenda(userId),
  ]);
  return {
    goal: new Set(goals.map((g) => g.id)),
    project: new Set(projects.map((p) => p.id)),
    habit: new Set(habits.map((h) => h.id)),
    task: new Set(tasks.map((t) => t.id)),
    note: new Set(notes.map((n) => n.id)),
    meeting: new Set(agenda.map((a) => a.id)),
  };
}
