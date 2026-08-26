/**
 * Where an entity is actually created, changed or removed.
 *
 * Three callers now write to the same rows: the UI's server actions, the
 * assistant's changeset apply, and the MCP server. They cannot each own a copy
 * of the invariants, because the invariants are not obvious and they are not
 * local. Creating a project also mints its flagship tag. Filing a task under
 * one moves its project tag and adds that flagship. Every entity carries a
 * life tag, and `lifeArea` is derived from the tags rather than set. A goal's
 * category mirrors its life area. A meeting's repeat rule has to be filled in
 * from a partial. Miss one and nothing throws: the row is simply subtly wrong,
 * in a way that shows up later as a project that will not count its tasks.
 *
 * This file was lifted out of lib/actions/changeset.ts unchanged. It is
 * deliberately not a "use server" module and knows nothing about sessions,
 * redirects or revalidation: it takes a userId and does the work. Each caller
 * supplies its own authorization and its own cache invalidation, which is the
 * part that genuinely differs between a form post and a JSON-RPC call.
 *
 * `resolve` exists for the assistant, whose changesets can reference a row
 * created earlier in the same batch by a temporary refId. Callers working with
 * ids that already exist pass `resolveExisting`.
 */
import {
  deleteAgendaItem,
  insertAgendaItem,
  listAgenda,
  updateAgendaItem,
} from "@/lib/db/agenda";
import type {
  ChangeEntity,
  CreateOp,
  UpdateOp,
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

export const HABIT_COLOR = "oklch(0.6 0.13 155)";

/**
 * The resolver for callers whose ids are already real, which is everyone
 * except the assistant's multi-op changesets.
 */
export const resolveExisting = (
  _entity: ChangeEntity,
  ref?: string | null,
): string | null => ref ?? null;

export type Ctx = {
  td: string;
  tags: Awaited<ReturnType<typeof listTags>>;
  resolve: (entity: ChangeEntity, ref?: string | null) => string | null;
  touchedProjects: Set<string>;
};

/** Absent, null or blank all mean "not set / unchanged". */
const val = (v: string | null | undefined): string | null => (v ? v : null);

export async function applyCreate(
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
    case "meeting": {
      // The repeat rule is filled in rather than passed through: the model
      // sends only what the user said, and the schema underneath wants every
      // key. `date` is the series start when it repeats, which is why a
      // meeting with a rule and no date still gets today rather than null.
      const repeat = f.repeat
        ? {
            freq: f.repeat.freq,
            interval: f.repeat.interval ?? 1,
            byWeekday: f.repeat.byWeekday ?? [],
            until: val(f.repeat.until),
            count: f.repeat.count ?? null,
          }
        : null;
      const m = await insertAgendaItem({
        userId,
        time: val(f.time) ?? "09:00",
        title: val(f.title) ?? "Untitled meeting",
        sub: "",
        color: area === "work" ? "var(--projects)" : "var(--calendar)",
        lifeArea: area,
        date: val(f.date) ?? td,
        kind: "meeting",
        durationMins: f.durationMins ?? 30,
        notes: f.description ?? "",
        recurrence: repeat,
        exceptions: [],
      });
      return { id: m.id, title: m.title };
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
export async function applyUpdate(
  userId: string,
  op: UpdateOp,
  // Takes `td` now, because completing a task stamps the date it was
  // completed, and "today" is the caller's day rather than the server's.
  ctx: Ctx,
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
      if (val(f.status)) {
        // `completedAt` moves with the status, the same way toggling a task by
        // hand does. Left alone, a task could read as done with no completion
        // date, or carry a stale one after being reopened, and every surface
        // that counts finished work would disagree with the board.
        patch.status = f.status;
        patch.completedAt = f.status === "done" ? ctx.td : null;
        before.status = current.status;
        before.completedAt = current.completedAt;
        // Finishing a task changes its project's progress, and a goal above it.
        if (current.projectId) ctx.touchedProjects.add(current.projectId);
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
    case "meeting": {
      const current = (await listAgenda(userId)).find((a) => a.id === op.id);
      if (!current) return null;
      const before: Record<string, unknown> = {};
      const set = <K extends string>(key: K, next: unknown, prev: unknown) => {
        if (next === undefined || next === null) return;
        patch[key] = next;
        before[key] = prev;
      };
      set("title", val(f.title), current.title);
      set("time", val(f.time), current.time);
      set("date", val(f.date), current.date);
      set("durationMins", f.durationMins, current.durationMins);
      set("notes", f.description, current.notes);
      set("lifeArea", val(f.lifeArea), current.lifeArea);
      if (f.repeat !== undefined) {
        patch.recurrence = f.repeat
          ? {
              freq: f.repeat.freq,
              interval: f.repeat.interval ?? 1,
              byWeekday: f.repeat.byWeekday ?? [],
              until: val(f.repeat.until),
              count: f.repeat.count ?? null,
            }
          : null;
        before.recurrence = current.recurrence;
      }
      return (await updateAgendaItem(userId, op.id, patch)) ? before : null;
    }
  }
}

export async function applyDelete(
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
    case "meeting":
      await deleteAgendaItem(userId, id);
      return;
    case "note":
      await deleteNote(userId, id);
      return;
  }
}

