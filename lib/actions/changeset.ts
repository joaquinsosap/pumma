"use server";

// The unified assistant's server half: run a request, preview a draft against
// live data, apply it, undo it. The apply engine executes typed ops in
// dependency order; creates and updates are undoable for the session, deletes
// are guarded by the confirmation step instead (resurrecting a deleted row
// with its old id is a can of worms this deliberately stays out of).
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types";
import { requireUserId } from "@/lib/auth/session";
import { userToday } from "@/lib/timezone-server";
import { AI_QUOTA_MESSAGE, reserveAiCall } from "@/lib/ai/quota";
import { aiInput } from "@/lib/validation";
import {
  changesetSchema,
  type Changeset,
  type ChangeEntity,
  type CreateOp,
  type UpdateOp,
} from "@/lib/ai/changeset-schema";
import {
  listGoals,
  insertGoal,
  updateGoal,
  deleteGoal,
  nextGoalOrder,
} from "@/lib/db/goals";
import {
  listProjects,
  insertProject,
  updateProject,
  deleteProject,
} from "@/lib/db/projects";
import {
  listHabits,
  insertHabit,
  updateHabit,
  deleteHabit,
} from "@/lib/db/habits";
import { listTasks, insertTask, updateTask, deleteTask } from "@/lib/db/tasks";
import { listNotes, insertNote, updateNote, deleteNote } from "@/lib/db/notes";
import { ensureTags, insertTag, listTags } from "@/lib/db/tags";
import { pickProjectColor } from "@/lib/project-colors";
import {
  deriveLifeAreaFromTags,
  goalCategoryForLifeArea,
  setLifeTags,
} from "@/lib/life-area-sync";
import {
  projectTagSlug,
  uniqueTagName,
  withSingleProjectTag,
} from "@/lib/project-tags";
import { syncGoalsForProject } from "@/lib/goal-sync-server";

const HABIT_COLOR = "oklch(0.6 0.13 155)";

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
    }[c.entity](userId, c.id);
    if (ok) reverted++;
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { reverted } };
}

// ---------------------------------------------------------------------------
// The per-entity engine

type Ctx = {
  td: string;
  tags: Awaited<ReturnType<typeof listTags>>;
  resolve: (entity: ChangeEntity, ref?: string | null) => string | null;
  touchedProjects: Set<string>;
};

/** Absent, null or blank all mean "not set / unchanged". */
const val = (v: string | null | undefined): string | null => (v ? v : null);

async function applyCreate(
  userId: string,
  op: CreateOp,
  ctx: Ctx,
): Promise<{ id: string; title: string } | null> {
  const { td, tags, resolve } = ctx;
  const f = op.fields;
  const area = (val(f.lifeArea) ?? "personal") as "personal" | "work";

  switch (op.entity) {
    case "goal": {
      const tagIds = setLifeTags([], area, tags);
      const goals = await listGoals(userId);
      const category = goalCategoryForLifeArea(area);
      const g = await insertGoal({
        userId,
        title: val(f.title) ?? "Untitled goal",
        category,
        metricLabel: "",
        progress: 0,
        targetDate: val(f.date),
        tagIds,
        lifeArea: deriveLifeAreaFromTags(tagIds, tags),
        order: nextGoalOrder(goals, category),
        createdAt: td,
      });
      return { id: g.id, title: g.title };
    }
    case "project": {
      const tagIds = setLifeTags([], area, tags);
      const projects = await listProjects(userId);
      const p = await insertProject({
        userId,
        title: val(f.title) ?? "Untitled project",
        description: f.description ?? "",
        color: pickProjectColor(projects),
        progress: 0,
        label: "0/0",
        goalId: resolve("goal", val(f.goalId)),
        tagIds,
        lifeArea: deriveLifeAreaFromTags(tagIds, tags),
        createdAt: td,
      });
      // Same rule as creating by hand: every project gets a flagship tag.
      await insertTag(
        userId,
        uniqueTagName(
          projectTagSlug(p.title),
          tags.map((t) => t.name),
        ),
        { projectId: p.id, isProjectPrimary: true, color: p.color },
      );
      ctx.touchedProjects.add(p.id);
      return { id: p.id, title: p.title };
    }
    case "habit": {
      const tagIds = setLifeTags([], area, tags);
      const goalIds = (f.goalIds ?? [])
        .map((r) => resolve("goal", r))
        .filter((id): id is string => id !== null);
      const h = await insertHabit({
        userId,
        name: val(f.title) ?? "Untitled habit",
        color: HABIT_COLOR,
        frequency: { type: val(f.frequency) ?? "daily", target: 1 },
        order: 999,
        archived: f.archived ?? false,
        goalIds,
        goalTargetStreak: null,
        tagIds,
        lifeArea: deriveLifeAreaFromTags(tagIds, tags),
        createdAt: td,
      });
      return { id: h.id, title: h.name };
    }
    case "task": {
      const projectId = resolve("project", val(f.projectId));
      const named = await ensureTags(userId, f.tagNames ?? []);
      // The task carries its life tag, and — when filed — the project's
      // flagship, so the tag-driven model holds for AI-created rows too.
      const fresh = await listTags(userId);
      let tagIds = setLifeTags(named, area, fresh);
      if (projectId) {
        tagIds = withSingleProjectTag(tagIds, projectId, fresh);
        const flagship = fresh.find(
          (t) => t.projectId === projectId && t.isProjectPrimary,
        );
        if (flagship && !tagIds.includes(flagship.id))
          tagIds = [...tagIds, flagship.id];
        ctx.touchedProjects.add(projectId);
      }
      const t = await insertTask({
        userId,
        title: val(f.title) ?? "Untitled task",
        description: f.description ?? "",
        subtasks: [],
        tagIds,
        priority: (val(f.priority) ?? "med") as "low" | "med" | "high",
        status: "todo",
        due: val(f.date),
        projectId,
        goalId: null,
        lifeArea: deriveLifeAreaFromTags(tagIds, fresh),
        order: -Date.now(),
        createdAt: td,
        completedAt: null,
      });
      return { id: t.id, title: t.title };
    }
    case "note": {
      const named = await ensureTags(userId, f.tagNames ?? []);
      const fresh = await listTags(userId);
      const tagIds = setLifeTags(named, area, fresh);
      const n = await insertNote({
        userId,
        title: val(f.title) ?? "Untitled note",
        // Scaffolding: an empty body is the normal case, not a failure.
        body: f.description ?? "",
        tagIds,
        pinned: false,
        lifeArea: deriveLifeAreaFromTags(tagIds, fresh),
        createdAt: td,
        updatedAt: td,
      });
      return { id: n.id, title: n.title };
    }
  }
}

/** Applies an update and returns the patch that reverses it, or null. */
async function applyUpdate(
  userId: string,
  op: UpdateOp,
  ctx: Omit<Ctx, "td">,
): Promise<Record<string, unknown> | null> {
  const { tags, resolve } = ctx;
  const f = op.fields;
  const patch: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};

  const applyLife = (
    currentTagIds: string[],
    current: { lifeArea: string; tagIds: string[] },
  ) => {
    const area = val(f.lifeArea);
    if (!area) return;
    const tagIds = setLifeTags(
      currentTagIds,
      area as "personal" | "work",
      tags,
    );
    patch.tagIds = tagIds;
    patch.lifeArea = deriveLifeAreaFromTags(tagIds, tags);
    if (before.tagIds === undefined) before.tagIds = current.tagIds;
    before.lifeArea = current.lifeArea;
  };

  switch (op.entity) {
    case "goal": {
      const current = (await listGoals(userId)).find((g) => g.id === op.id);
      if (!current) return null;
      if (val(f.title)) {
        patch.title = f.title;
        before.title = current.title;
      }
      if (val(f.date)) {
        patch.targetDate = f.date;
        before.targetDate = current.targetDate;
      }
      applyLife(current.tagIds, current);
      if (patch.lifeArea) {
        patch.category = goalCategoryForLifeArea(
          patch.lifeArea as "personal" | "work" | "both",
        );
        before.category = current.category;
      }
      return (await updateGoal(userId, op.id, patch)) ? before : null;
    }
    case "project": {
      const current = (await listProjects(userId)).find((p) => p.id === op.id);
      if (!current) return null;
      if (val(f.title)) {
        patch.title = f.title;
        before.title = current.title;
      }
      if (val(f.description)) {
        patch.description = f.description;
        before.description = current.description;
      }
      if (val(f.goalId)) {
        patch.goalId = resolve("goal", f.goalId);
        before.goalId = current.goalId;
      }
      applyLife(current.tagIds, current);
      ctx.touchedProjects.add(op.id);
      return (await updateProject(userId, op.id, patch)) ? before : null;
    }
    case "habit": {
      const current = (await listHabits(userId)).find((h) => h.id === op.id);
      if (!current) return null;
      if (val(f.title)) {
        patch.name = f.title;
        before.name = current.name;
      }
      if (val(f.frequency)) {
        patch.frequency = { type: f.frequency, target: 1 };
        before.frequency = current.frequency;
      }
      if (f.goalIds?.length) {
        patch.goalIds = f.goalIds
          .map((r) => resolve("goal", r))
          .filter(Boolean);
        before.goalIds = current.goalIds;
      }
      if (f.archived !== undefined) {
        patch.archived = f.archived;
        before.archived = current.archived;
      }
      applyLife(current.tagIds, current);
      return (await updateHabit(userId, op.id, patch)) ? before : null;
    }
    case "task": {
      const current = (await listTasks(userId)).find((t) => t.id === op.id);
      if (!current) return null;
      if (val(f.title)) {
        patch.title = f.title;
        before.title = current.title;
      }
      if (val(f.description)) {
        patch.description = f.description;
        before.description = current.description;
      }
      if (val(f.priority)) {
        patch.priority = f.priority;
        before.priority = current.priority;
      }
      if (val(f.date)) {
        patch.due = f.date;
        before.due = current.due;
      }
      if (val(f.projectId)) {
        const projectId = resolve("project", f.projectId);
        let tagIds = withSingleProjectTag(current.tagIds, projectId, tags);
        const flagship = projectId
          ? tags.find((t) => t.projectId === projectId && t.isProjectPrimary)
          : null;
        if (flagship && !tagIds.includes(flagship.id))
          tagIds = [...tagIds, flagship.id];
        patch.projectId = projectId;
        patch.tagIds = tagIds;
        before.projectId = current.projectId;
        before.tagIds = current.tagIds;
        if (current.projectId) ctx.touchedProjects.add(current.projectId);
        if (projectId) ctx.touchedProjects.add(projectId);
      }
      applyLife((patch.tagIds as string[]) ?? current.tagIds, current);
      return (await updateTask(userId, op.id, patch)) ? before : null;
    }
    case "note": {
      const current = (await listNotes(userId)).find((n) => n.id === op.id);
      if (!current) return null;
      if (val(f.title)) {
        patch.title = f.title;
        before.title = current.title;
      }
      if (val(f.description)) {
        patch.body = f.description;
        before.body = current.body;
      }
      applyLife(current.tagIds, current);
      return (await updateNote(userId, op.id, patch)) ? before : null;
    }
  }
}

async function applyDelete(
  userId: string,
  entity: ChangeEntity,
  id: string,
  touchedProjects: Set<string>,
): Promise<void> {
  switch (entity) {
    case "goal":
      await deleteGoal(userId, id);
      return;
    case "project":
      await deleteProject(userId, id, { deleteTasks: true });
      touchedProjects.delete(id);
      return;
    case "habit":
      await deleteHabit(userId, id);
      return;
    case "task": {
      const task = (await listTasks(userId)).find((t) => t.id === id);
      if (task?.projectId) touchedProjects.add(task.projectId);
      await deleteTask(userId, id);
      return;
    }
    case "note":
      await deleteNote(userId, id);
      return;
  }
}

async function liveIds(
  userId: string,
): Promise<Record<ChangeEntity, Set<string>>> {
  const [goals, projects, habits, tasks, notes] = await Promise.all([
    listGoals(userId),
    listProjects(userId),
    listHabits(userId),
    listTasks(userId),
    listNotes(userId),
  ]);
  return {
    goal: new Set(goals.map((g) => g.id)),
    project: new Set(projects.map((p) => p.id)),
    habit: new Set(habits.map((h) => h.id)),
    task: new Set(tasks.map((t) => t.id)),
    note: new Set(notes.map((n) => n.id)),
  };
}
