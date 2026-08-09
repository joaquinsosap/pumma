"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/types";
import { requireUserId } from "@/lib/auth/session";
import { parseOmni, defaultDue, parseNoteCapture } from "@/lib/parse";
import { listTags, ensureTags } from "@/lib/db/tags";
import {
  insertTask,
  updateTask,
  deleteTask as removeTask,
} from "@/lib/db/tasks";
import { getProject } from "@/lib/db/projects";
import { insertNote } from "@/lib/db/notes";
import { insertHabit } from "@/lib/db/habits";
import { insertGoal, listGoals, nextGoalOrder } from "@/lib/db/goals";
import { getSettings } from "@/lib/db/settings";
import { userToday } from "@/lib/timezone-server";
import type { Task } from "@/lib/schemas";
import { syncGoalsForProject } from "@/lib/goal-sync-server";
import {
  deriveLifeAreaFromTags,
  withLifeTags,
  withProjectLifeTags,
  setLifeTags,
  hasLifeTag,
  goalCategoryForLifeArea,
} from "@/lib/life-area-sync";
import {
  withProjectPrimaryTag,
  withSingleProjectTag,
  splitTagsByProject,
  projectIdFromTags,
} from "@/lib/project-tags";
import { entityId, title as titleField, noteBody } from "@/lib/validation";

const omniSchema = z.object({
  text: z.string().min(1),
  type: z.enum(["task", "habit", "goal", "note"]),
  projectId: z.string().nullable().optional(),
  due: z.string().nullable().optional(),
  priority: z.enum(["low", "med", "high"]).optional(),
  goalCategory: z.enum(["personal", "work"]).optional(),
  // The view, not a collapsed area: capturing in Both must be able to attach
  // both life tags, which "personal" | "work" can't express.
  lifeView: z.enum(["personal", "work", "both"]).optional(),
  tagIds: z.array(z.string()).optional(),
});

export async function createFromOmni(
  input: z.infer<typeof omniSchema>,
): Promise<ActionResult<{ id: string; label: string }>> {
  const parsed = omniSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const {
    text,
    type,
    projectId,
    due: dueOverride,
    priority: priorityOverride,
    goalCategory,
    lifeView,
    tagIds: pickedTagIds,
  } = parsed.data;
  const userId = await requireUserId();
  const settings = await getSettings(userId);
  const tags = await listTags(userId);
  const { timeZone, today: td } = await userToday();
  const p = parseOmni(
    text,
    tags,
    undefined,
    { dateOrder: settings?.dateOrder },
    timeZone,
  );
  const newTagIds = await ensureTags(userId, p.newTagNames);
  // A stale client can send ids of tags/projects deleted since its last render —
  // silently drop dead links instead of persisting dangling references.
  const validPickedTagIds = (pickedTagIds ?? []).filter((id) =>
    tags.some((t) => t.id === id),
  );
  const view = lifeView ?? "personal";
  // Every item leaves here carrying a life tag — that's the only thing the
  // personal/work split reads from.
  const tagIds = withLifeTags(
    [...new Set([...validPickedTagIds, ...p.tagIds, ...newTagIds])],
    view,
    tags,
  );
  const title = p.title || text.trim();

  if (type === "task") {
    const due =
      p.due ??
      dueOverride ??
      defaultDue(null, settings?.defaultDueToday ?? true, td);

    // Tags from two projects mean two pieces of work. Rather than pick a
    // winner, the capture becomes one task per project, each carrying only
    // that project's tags — see docs/tags-and-projects.md.
    const buckets = splitTagsByProject(tagIds, tags);
    const scoped = projectId ? await getProject(userId, projectId) : null;

    const created = [];
    for (const bucket of buckets) {
      // An untagged capture still files into the project you're looking at.
      const target = bucket.projectId
        ? await getProject(userId, bucket.projectId)
        : scoped;
      const bucketTags = withProjectLifeTags(
        bucket.projectId
          ? bucket.tagIds
          : withProjectPrimaryTag(
              withSingleProjectTag(bucket.tagIds, target?.id ?? null, tags),
              target?.id ?? null,
              tags,
            ),
        target?.lifeArea,
        tags,
      );
      created.push(
        await insertTask({
          userId,
          title,
          description: p.description,
          tagIds: bucketTags,
          // A "!high" in the text is the more specific instruction, so it wins
          // over whatever the picker is showing — the picker hides itself then.
          priority: p.hasPriorityToken
            ? p.priority
            : (priorityOverride ?? p.priority),
          status: "todo",
          due,
          projectId: target?.id ?? null,
          goalId: null,
          lifeArea: deriveLifeAreaFromTags(bucketTags, tags),
          order: -Date.now(),
          createdAt: td,
          completedAt: null,
        }),
      );
    }

    for (const bucket of buckets) {
      if (bucket.projectId) await syncGoalsForProject(userId, bucket.projectId);
    }

    revalidatePath("/", "layout");
    const label =
      created.length > 1
        ? `Task added to ${created.length} projects`
        : "Task added";
    return {
      ok: true,
      data: { id: created[0].id, label },
      // Undo removes every copy the capture made, not just the first.
      undo: {
        type: "create",
        entity: "task",
        snapshot: created.map((t) => t.id).join(","),
      },
    };
  }

  if (type === "note") {
    const noteParsed = parseNoteCapture(text, tags, undefined, timeZone);
    const noteTagIds = withLifeTags(
      [...new Set([...validPickedTagIds, ...noteParsed.tagIds, ...newTagIds])],
      view,
      tags,
    );
    const note = await insertNote({
      userId,
      title: noteParsed.title,
      body: noteParsed.body,
      tagIds: noteTagIds,
      pinned: false,
      lifeArea: deriveLifeAreaFromTags(noteTagIds, tags),
      createdAt: td,
      updatedAt: td,
    });
    revalidatePath("/", "layout");
    return {
      ok: true,
      data: { id: note.id, label: "Note saved" },
      undo: { type: "create", entity: "note", snapshot: note.id },
    };
  }

  if (type === "habit") {
    const habit = await insertHabit({
      userId,
      name: title,
      color: "oklch(0.6 0.13 155)",
      frequency: { type: "daily", target: 1 },
      order: 999,
      archived: false,
      goalIds: [],
      goalTargetStreak: null,
      tagIds,
      lifeArea: deriveLifeAreaFromTags(tagIds, tags),
      createdAt: td,
    });
    revalidatePath("/", "layout");
    return {
      ok: true,
      data: { id: habit.id, label: "Habit created" },
      undo: { type: "create", entity: "habit", snapshot: habit.id },
    };
  }

  // The column you captured from says which side of life a goal is on — but
  // only as a default. Typing "#work" from the Personal column is the more
  // specific instruction and wins, which is why this looks for a life tag that
  // was actually asked for rather than one the view supplied.
  const askedForLife = hasLifeTag(
    [...validPickedTagIds, ...p.tagIds, ...newTagIds],
    tags,
  );
  const goalTagIds =
    goalCategory && !askedForLife
      ? setLifeTags(tagIds, goalCategory, tags)
      : tagIds;
  const goalLife = deriveLifeAreaFromTags(goalTagIds, tags);
  const category = goalCategoryForLifeArea(goalLife);
  const existingGoals = await listGoals(userId);
  const goal = await insertGoal({
    userId,
    title,
    category,
    metricLabel: "",
    progress: 0,
    targetDate: p.due,
    tagIds: goalTagIds,
    lifeArea: goalLife,
    order: nextGoalOrder(existingGoals, category),
    createdAt: td,
  });
  revalidatePath("/", "layout");
  return {
    ok: true,
    data: { id: goal.id, label: "Goal set" },
    undo: { type: "create", entity: "goal", snapshot: goal.id },
  };
}

const addTaskSchema = z.object({
  text: z.string().min(1),
  due: z.string().nullable().optional(),
  priority: z.enum(["low", "med", "high"]).optional(),
  projectId: z.string().nullable().optional(),
  lifeView: z.enum(["personal", "work", "both"]).optional(),
});

export async function addTask(
  input: z.infer<typeof addTaskSchema>,
): Promise<ActionResult<Task>> {
  const parsed = addTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const userId = await requireUserId();
  const tags = await listTags(userId);
  const settings = await getSettings(userId);
  const { timeZone, today: td } = await userToday();
  const p = parseOmni(
    parsed.data.text,
    tags,
    undefined,
    { dateOrder: settings?.dateOrder },
    timeZone,
  );
  const newTagIds = await ensureTags(userId, p.newTagNames);
  const tagIds = withLifeTags(
    [...new Set([...p.tagIds, ...newTagIds])],
    parsed.data.lifeView ?? "personal",
    tags,
  );
  // A project tag in the text wins; otherwise the caller's project, if it
  // still exists (stale clients can point at a deleted one).
  const taggedProjectId = projectIdFromTags(tagIds, tags);
  const project = taggedProjectId
    ? await getProject(userId, taggedProjectId)
    : parsed.data.projectId
      ? await getProject(userId, parsed.data.projectId)
      : null;
  // Same rule as quick capture: a task filed under a project carries that
  // project's tag, whether the project came from the text or from the view.
  const finalTagIds = withProjectPrimaryTag(tagIds, project?.id ?? null, tags);
  const task = await insertTask({
    userId,
    title: p.title,
    description: p.description,
    tagIds: finalTagIds,
    // A "!high" in the text is the more specific instruction, so it wins over
    // whatever the picker is showing — the picker hides itself in that case.
    priority: p.hasPriorityToken
      ? p.priority
      : (parsed.data.priority ?? p.priority),
    status: "todo",
    // Respect "default due today" — this used to hardcode today, so turning
    // the setting off changed nothing.
    due:
      parsed.data.due ??
      defaultDue(p.due, settings?.defaultDueToday ?? true, td),
    projectId: project?.id ?? null,
    goalId: null,
    lifeArea: deriveLifeAreaFromTags(finalTagIds, tags),
    order: -Date.now(),
    createdAt: td,
    completedAt: null,
  });
  revalidatePath("/", "layout");
  return {
    ok: true,
    data: task,
    undo: { type: "create", entity: "task", snapshot: task.id },
  };
}

export async function toggleTask(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const { getTask } = await import("@/lib/db/tasks");
  const task = await getTask(userId, id);
  if (!task) return { ok: false, error: "Not found" };
  const { today: td } = await userToday();
  const done = task.status !== "done";
  await updateTask(userId, id, {
    status: done ? "done" : "todo",
    completedAt: done ? td : null,
  });
  if (task.projectId) await syncGoalsForProject(userId, task.projectId);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function cycleTaskPriority(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const { getTask } = await import("@/lib/db/tasks");
  const task = await getTask(userId, id);
  if (!task) return { ok: false, error: "Not found" };
  const order = ["low", "med", "high"] as const;
  const next = order[(order.indexOf(task.priority) + 1) % 3];
  await updateTask(userId, id, { priority: next });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function renameTask(
  id: string,
  title: string,
): Promise<ActionResult> {
  const parsedTitle = titleField.safeParse(title);
  if (!parsedTitle.success) return { ok: false, error: "Invalid title" };
  const userId = await requireUserId();
  await updateTask(userId, id, { title: parsedTitle.data });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteTaskAction(id: string): Promise<ActionResult> {
  const userId = await requireUserId();
  const { getTask } = await import("@/lib/db/tasks");
  const task = await getTask(userId, id);
  if (!task) return { ok: false, error: "Not found" };
  await removeTask(userId, id);
  revalidatePath("/", "layout");
  return {
    ok: true,
    undo: { type: "delete", entity: "task", snapshot: task },
  };
}

export async function moveTaskStatus(
  id: string,
  status: "todo" | "doing" | "done",
): Promise<ActionResult> {
  // Runtime-guard the status: the TS union doesn't constrain the deserialized
  // action argument, so a crafted call could otherwise $set an arbitrary string.
  if (status !== "todo" && status !== "doing" && status !== "done") {
    return { ok: false, error: "Invalid status" };
  }
  const userId = await requireUserId();
  const { getTask } = await import("@/lib/db/tasks");
  const task = await getTask(userId, id);
  if (!task) return { ok: false, error: "Not found" };
  const { today: td } = await userToday();
  await updateTask(userId, id, {
    status,
    completedAt: status === "done" ? td : null,
  });
  if (task.projectId) await syncGoalsForProject(userId, task.projectId);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function undoCreate(
  entity: string,
  id: string,
): Promise<ActionResult> {
  const userId = await requireUserId();
  // A capture tagged for several projects creates one task each, so undo has
  // to take them all back — the snapshot is a comma-joined list.
  const ids = String(id).split(",").filter(Boolean).slice(0, 50);
  if (entity === "task") {
    for (const one of ids) await removeTask(userId, one);
  } else if (entity === "note") {
    const { deleteNote } = await import("@/lib/db/notes");
    for (const one of ids) await deleteNote(userId, one);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function undoDeleteTask(snapshot: string): Promise<ActionResult> {
  const userId = await requireUserId();
  // Cap the payload before parsing — the snapshot is client-echoed, so bound it.
  if (typeof snapshot !== "string" || snapshot.length > 100_000) {
    return { ok: false, error: "Invalid snapshot" };
  }
  let task: Task;
  try {
    task = JSON.parse(snapshot);
    if (!task || typeof task !== "object") throw new Error("not an object");
  } catch {
    return { ok: false, error: "Invalid snapshot" };
  }
  // Linked entities may have been deleted since the snapshot was taken —
  // restore the task without the dead links.
  const [tags, goals] = await Promise.all([
    listTags(userId),
    listGoals(userId),
  ]);
  const project = task.projectId
    ? await getProject(userId, task.projectId)
    : null;
  await insertTask({
    ...task,
    _id: task.id,
    userId,
    projectId: project ? task.projectId : null,
    goalId: goals.some((g) => g.id === task.goalId) ? task.goalId : null,
    tagIds: (task.tagIds ?? []).filter((id) => tags.some((t) => t.id === id)),
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Bulk edits
//
// One action rather than N calls from the client: N server actions would be
// N round trips, N revalidations and N chances to half-apply. These loop
// server-side and revalidate once, and they reuse exactly the rules the
// single-task paths use — a bulk move has to rewrite project tags and life
// tags the same way dragging one task does, or the two ways of doing the same
// thing would disagree.

const bulkUpdateSchema = z.object({
  ids: z.array(entityId).min(1).max(200),
  priority: z.enum(["low", "med", "high"]).optional(),
  status: z.enum(["todo", "doing", "done"]).optional(),
  /** null moves them out of every project. */
  projectId: entityId.nullable().optional(),
  /** null clears the due date. */
  due: z.string().max(40).nullable().optional(),
  addTagIds: z.array(entityId).max(50).optional(),
  removeTagIds: z.array(entityId).max(50).optional(),
});

export type BulkTaskPatch = z.infer<typeof bulkUpdateSchema>;

export async function bulkUpdateTasks(
  input: BulkTaskPatch,
): Promise<ActionResult<{ updated: number }>> {
  const parsed = bulkUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const { ids, priority, status, projectId, due, addTagIds, removeTagIds } =
    parsed.data;
  const touchesSomething =
    priority !== undefined ||
    status !== undefined ||
    projectId !== undefined ||
    due !== undefined ||
    addTagIds?.length ||
    removeTagIds?.length;
  if (!touchesSomething) return { ok: false, error: "Nothing to update" };

  const userId = await requireUserId();
  const { getTask } = await import("@/lib/db/tasks");
  const tags = await listTags(userId);

  // A stale client can name a project deleted since it last rendered. Refuse
  // rather than quietly dropping every selected task out of its project.
  const target =
    projectId !== undefined && projectId !== null
      ? await getProject(userId, projectId)
      : null;
  if (projectId && !target) {
    return { ok: false, error: "That project no longer exists" };
  }

  const { today: td } = await userToday();
  // Only tag ids that still exist — same guard updateTaskDetail applies.
  const add = (addTagIds ?? []).filter((id) => tags.some((t) => t.id === id));
  const remove = new Set(removeTagIds ?? []);

  // Both ends of every move need their goal progress recomputed, but a project
  // that appears fifty times only needs it once.
  const projectsToSync = new Set<string>();
  let updated = 0;

  for (const id of ids) {
    const task = await getTask(userId, id);
    if (!task) continue;

    const patch: Parameters<typeof updateTask>[2] = {};
    if (priority !== undefined) patch.priority = priority;
    if (due !== undefined) patch.due = due === "" ? null : due;
    if (status !== undefined) {
      patch.status = status;
      patch.completedAt = status === "done" ? td : null;
    }

    const retagging = add.length > 0 || remove.size > 0;
    if (retagging || projectId !== undefined) {
      let tagIds = task.tagIds.filter((t) => !remove.has(t));
      for (const t of add) if (!tagIds.includes(t)) tagIds.push(t);

      // An explicit project wins; otherwise a project tag that came in with
      // `add` files the task, exactly as toggling that tag on its own would.
      const nextProjectId =
        projectId !== undefined ? projectId : projectIdFromTags(tagIds, tags);

      tagIds = withSingleProjectTag(tagIds, nextProjectId, tags);
      if (nextProjectId && nextProjectId !== task.projectId) {
        const dest =
          target && target.id === nextProjectId
            ? target
            : await getProject(userId, nextProjectId);
        // The project decides the side of life now — a task in a work project
        // is work, whatever it used to carry.
        tagIds = withProjectLifeTags(tagIds, dest?.lifeArea, tags);
        const flagship = tags.find(
          (t) => t.projectId === nextProjectId && t.isProjectPrimary,
        );
        if (flagship && !tagIds.includes(flagship.id)) tagIds.push(flagship.id);
      }

      patch.tagIds = tagIds;
      patch.lifeArea = deriveLifeAreaFromTags(tagIds, tags);
      patch.projectId = nextProjectId;

      if (task.projectId && task.projectId !== nextProjectId) {
        projectsToSync.add(task.projectId);
      }
      if (nextProjectId) projectsToSync.add(nextProjectId);
    } else if (task.projectId) {
      // Status and priority feed project progress too.
      projectsToSync.add(task.projectId);
    }

    if (await updateTask(userId, id, patch)) updated++;
  }

  for (const pid of projectsToSync) await syncGoalsForProject(userId, pid);
  revalidatePath("/", "layout");
  return { ok: true, data: { updated } };
}

const bulkDeleteSchema = z.object({
  ids: z.array(entityId).min(1).max(200),
});

/**
 * Delete several tasks, handing back one snapshot blob so a single UNDO on the
 * toast brings the whole batch back.
 */
export async function bulkDeleteTasks(
  input: z.infer<typeof bulkDeleteSchema>,
): Promise<ActionResult<{ deleted: number }>> {
  const parsed = bulkDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const userId = await requireUserId();
  const { getTask } = await import("@/lib/db/tasks");
  const snapshots: Task[] = [];
  const projectsToSync = new Set<string>();

  for (const id of parsed.data.ids) {
    const task = await getTask(userId, id);
    if (!task) continue;
    snapshots.push(task);
    if (task.projectId) projectsToSync.add(task.projectId);
    await removeTask(userId, id);
  }

  for (const pid of projectsToSync) await syncGoalsForProject(userId, pid);
  revalidatePath("/", "layout");
  return {
    ok: true,
    data: { deleted: snapshots.length },
    undo: { type: "delete", entity: "task", snapshot: snapshots },
  };
}

/** Restore a batch taken by bulkDeleteTasks. */
export async function undoDeleteTasks(snapshot: string): Promise<ActionResult> {
  const userId = await requireUserId();
  // Client-echoed, so bound it before parsing. 200 tasks of prose fit well
  // inside this; anything larger is not a batch this UI produced.
  if (typeof snapshot !== "string" || snapshot.length > 2_000_000) {
    return { ok: false, error: "Invalid snapshot" };
  }
  let batch: Task[];
  try {
    const raw = JSON.parse(snapshot);
    if (!Array.isArray(raw)) throw new Error("not an array");
    batch = raw.slice(0, 200);
  } catch {
    return { ok: false, error: "Invalid snapshot" };
  }

  const [tags, goals] = await Promise.all([
    listTags(userId),
    listGoals(userId),
  ]);
  const projectsToSync = new Set<string>();
  for (const task of batch) {
    if (!task || typeof task !== "object" || !task.id) continue;
    // Linked entities may have gone since the snapshot was taken — restore
    // without the dead links rather than resurrecting a dangling reference.
    const project = task.projectId
      ? await getProject(userId, task.projectId)
      : null;
    await insertTask({
      ...task,
      _id: task.id,
      userId,
      projectId: project ? task.projectId : null,
      goalId: goals.some((g) => g.id === task.goalId) ? task.goalId : null,
      tagIds: (task.tagIds ?? []).filter((id) => tags.some((t) => t.id === id)),
    });
    if (project) projectsToSync.add(project.id);
  }

  for (const pid of projectsToSync) await syncGoalsForProject(userId, pid);
  revalidatePath("/", "layout");
  return { ok: true };
}

const setTaskProjectSchema = z.object({
  id: entityId,
  projectId: entityId.nullable(),
});

/**
 * Move a task into a project, or out of every project with `null`.
 *
 * Shared by the drag-between-groups gesture and the picker in the detail
 * panel, so both go through the same ownership checks and the same goal
 * resync.
 */
export async function setTaskProject(
  input: z.infer<typeof setTaskProjectSchema>,
): Promise<ActionResult<Task>> {
  const parsed = setTaskProjectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const userId = await requireUserId();
  const { getTask } = await import("@/lib/db/tasks");
  const existing = await getTask(userId, parsed.data.id);
  if (!existing) return { ok: false, error: "Not found" };

  // A stale client can name a project that was deleted since it last rendered;
  // refuse rather than quietly dropping the task out of every project.
  const project = parsed.data.projectId
    ? await getProject(userId, parsed.data.projectId)
    : null;
  if (parsed.data.projectId && !project) {
    return { ok: false, error: "That project no longer exists" };
  }

  const nextProjectId = project ? parsed.data.projectId : null;
  if (nextProjectId === existing.projectId) return { ok: true, data: existing };

  // Tags and projectId are two views of one fact, so moving by drag or by the
  // picker has to rewrite the tags the same way tagging would.
  const tags = await listTags(userId);
  const flagship = nextProjectId
    ? tags.find((t) => t.projectId === nextProjectId && t.isProjectPrimary)
    : null;
  let tagIds = withSingleProjectTag(existing.tagIds, nextProjectId, tags);
  if (flagship && !tagIds.includes(flagship.id))
    tagIds = [...tagIds, flagship.id];
  // The project decides the side of life now, replacing whatever the task had.
  tagIds = withProjectLifeTags(tagIds, project?.lifeArea, tags);

  const updated = await updateTask(userId, parsed.data.id, {
    projectId: nextProjectId,
    tagIds,
    lifeArea: deriveLifeAreaFromTags(tagIds, tags),
  });
  if (!updated) return { ok: false, error: "Not found" };

  // Goal progress rolls up per project, so both ends of the move resettle.
  if (existing.projectId) await syncGoalsForProject(userId, existing.projectId);
  if (nextProjectId) await syncGoalsForProject(userId, nextProjectId);

  revalidatePath("/", "layout");
  return { ok: true, data: updated };
}

const subtaskSchema = z.object({
  id: z.string().max(64),
  title: z.string().max(500),
  done: z.boolean(),
});

const updateTaskDetailSchema = z.object({
  id: entityId,
  title: titleField.optional(),
  description: noteBody.optional(),
  subtasks: z.array(subtaskSchema).max(200).optional(),
  tagIds: z.array(z.string()).max(50).optional(),
  priority: z.enum(["low", "med", "high"]).optional(),
  due: z.string().max(40).nullable().optional(),
});

export async function updateTaskDetail(
  input: z.infer<typeof updateTaskDetailSchema>,
): Promise<ActionResult<Task>> {
  const parsed = updateTaskDetailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const { id, ...patch } = parsed.data;
  if (!Object.keys(patch).length)
    return { ok: false, error: "Nothing to update" };

  const userId = await requireUserId();
  const { getTask } = await import("@/lib/db/tasks");
  const existing = await getTask(userId, id);
  if (!existing) return { ok: false, error: "Not found" };

  // Drop tag ids that no longer exist (deleted since the client last rendered).
  let tagPatch: { tagIds: string[]; lifeArea: Task["lifeArea"] } | undefined;
  if (patch.tagIds !== undefined) {
    const tags = await listTags(userId);
    const tagIds = patch.tagIds.filter((tid) => tags.some((t) => t.id === tid));
    tagPatch = {
      tagIds,
      lifeArea: deriveLifeAreaFromTags(tagIds, tags),
    };
  }

  const normalized = {
    ...patch,
    ...(patch.due !== undefined
      ? { due: patch.due === "" ? null : patch.due }
      : {}),
    ...(tagPatch ?? {}),
  };

  const updated = await updateTask(userId, id, normalized);
  if (!updated) return { ok: false, error: "Not found" };

  if (existing.projectId) await syncGoalsForProject(userId, existing.projectId);

  // Whole-app on purpose. Scoping this to the routes that "obviously" show a
  // task is a trap: every page renders its own Topbar, and that reads
  // day-done counts off the task list — so editing a due date here changes
  // what /habits and /notes should be showing too. Narrowing it left those
  // stale, and a stale number is a worse bug than an extra fetch.
  revalidatePath("/", "layout");
  return { ok: true, data: updated };
}
