"use server";

import { revalidatePath } from "next/cache";
import {
  listTags,
  insertTag,
  deleteTag,
  detachTagFromProject,
  setTagProject,
} from "@/lib/db/tags";
import {
  deriveLifeAreaFromTags,
  isLifeTag,
  setLifeTags,
} from "@/lib/life-area-sync";
import { projectTagSlug, uniqueTagName } from "@/lib/project-tags";
import { z } from "zod";
import type { ActionResult } from "@/lib/types";
import type { Project } from "@/lib/schemas";
import {
  getProject,
  insertProject,
  listProjects,
  updateProject,
  deleteProject,
} from "@/lib/db/projects";
import { syncGoalProgress, syncGoalsForProject } from "@/lib/goal-sync-server";
import { setProjectLifeArea } from "@/lib/project-life-server";
import { fileTaggedTasksIntoProject } from "@/lib/project-filing-server";
import { requireUserId } from "@/lib/auth/session";
import { userToday } from "@/lib/timezone-server";
import { pickProjectColor } from "@/lib/project-colors";

const createProjectSchema = z.object({
  title: z.string().trim().min(1).max(120),
  lifeArea: z.enum(["personal", "work"]).optional(),
  color: z.string().optional(),
});

export type CreatedProject = {
  project: Project;
  /** Set when the flagship was an existing tag rather than a new one. */
  adopted: { tagName: string; filed: number } | null;
};

export async function createProjectAction(
  input: z.infer<typeof createProjectSchema>,
): Promise<ActionResult<CreatedProject>> {
  const parsed = createProjectSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const userId = await requireUserId();
  const { today: createdAt } = await userToday();
  const existing = await listProjects(userId);
  // The project carries its own life tags — the side of life it's on is read
  // from them, never from a separate field.
  const allTags = await listTags(userId);
  const projectTagIds = setLifeTags(
    [],
    parsed.data.lifeArea ?? "personal",
    allTags,
  );
  const project = await insertProject({
    userId,
    title: parsed.data.title,
    description: "",
    color: parsed.data.color ?? pickProjectColor(existing),
    progress: 0,
    label: "0/0",
    goalId: null,
    tagIds: projectTagIds,
    lifeArea: deriveLifeAreaFromTags(projectTagIds, allTags),
    createdAt,
  });

  // Every project gets a flagship tag named after it, so "#wr" on a task is
  // enough to file it here. It's the hint that this works at all.
  const slug = projectTagSlug(parsed.data.title);
  const match = allTags.find((t) => t.name.toLowerCase() === slug);
  // A tag by that name already meaning this work is the whole point — adopt it
  // rather than making a near-identical twin, and bring what it holds along.
  // A tag another project owns can't be taken, so that one gets a number.
  const adoptable = match && !match.projectId && !isLifeTag(match.name);

  let adopted: { tagName: string; filed: number } | null = null;
  if (adoptable) {
    await setTagProject(userId, match.id, project.id, { primary: true });
    const filed = await fileTaggedTasksIntoProject(
      userId,
      project,
      match.id,
      allTags.map((t) =>
        t.id === match.id ? { ...t, projectId: project.id } : t,
      ),
    );
    adopted = { tagName: match.name, filed };
  } else {
    await insertTag(
      userId,
      uniqueTagName(
        slug,
        allTags.map((t) => t.name),
      ),
      { projectId: project.id, isProjectPrimary: true, color: project.color },
    );
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { project, adopted } };
}

const projectTagSchema = z.object({
  projectId: z.string(),
  tagId: z.string(),
});

/**
 * Give an existing tag to a project.
 *
 * Refused if the tag already belongs to another project: a tag files things
 * into exactly one place, and letting two projects claim one would make "#ai"
 * ambiguous. Life tags are refused too — they mean the personal/work split,
 * not a project.
 */
export async function attachTagToProjectAction(
  input: z.infer<typeof projectTagSchema>,
): Promise<ActionResult<{ filed: number }>> {
  const parsed = projectTagSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const userId = await requireUserId();
  const project = await getProject(userId, parsed.data.projectId);
  if (!project) return { ok: false, error: "Project not found" };

  const tags = await listTags(userId);
  const tag = tags.find((t) => t.id === parsed.data.tagId);
  if (!tag) return { ok: false, error: "Tag not found" };
  if (isLifeTag(tag.name)) {
    return {
      ok: false,
      error: `"${tag.name}" is a life tag, not a project tag`,
    };
  }
  if (tag.projectId && tag.projectId !== project.id) {
    const owner = (await listProjects(userId)).find(
      (p) => p.id === tag.projectId,
    );
    return {
      ok: false,
      error: `"${tag.name}" already belongs to ${owner?.title ?? "another project"}`,
    };
  }

  await setTagProject(userId, tag.id, project.id);
  const filed = await fileTaggedTasksIntoProject(
    userId,
    project,
    tag.id,
    tags.map((t) => (t.id === tag.id ? { ...t, projectId: project.id } : t)),
  );

  revalidatePath("/", "layout");
  return { ok: true, data: { filed } };
}

/** Release a tag back to being an ordinary label. The flagship can't go. */
export async function detachTagFromProjectAction(
  tagId: string,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const tag = (await listTags(userId)).find((t) => t.id === tagId);
  if (!tag) return { ok: false, error: "Tag not found" };
  if (tag.isProjectPrimary) {
    return {
      ok: false,
      error: "That's the project's own tag, so rename it instead",
    };
  }

  await detachTagFromProject(userId, tagId);
  revalidatePath("/", "layout");
  return { ok: true };
}

const updateProjectDetailSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  lifeArea: z.enum(["personal", "work", "both"]).optional(),
  color: z.string().optional(),
});

export async function updateProjectDetail(
  input: z.infer<typeof updateProjectDetailSchema>,
): Promise<ActionResult<Project>> {
  const parsed = updateProjectDetailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const { id, lifeArea, ...patch } = parsed.data;
  if (!Object.keys(parsed.data).length) {
    return { ok: false, error: "Nothing to update" };
  }

  const userId = await requireUserId();
  const existing = await getProject(userId, id);
  if (!existing) return { ok: false, error: "Not found" };

  // Switching sides rewrites the life tags — lifeArea is only ever their echo —
  // and carries the project's tasks across with it.
  if (lifeArea && lifeArea !== existing.lifeArea) {
    await setProjectLifeArea(
      userId,
      existing,
      lifeArea,
      await listTags(userId),
    );
  }

  const updated = await updateProject(userId, id, patch);
  if (!updated) return { ok: false, error: "Not found" };

  if (existing.goalId) await syncGoalsForProject(userId, id);
  revalidatePath("/", "layout");
  return { ok: true, data: updated };
}

export async function deleteProjectAction(
  id: string,
  opts: { deleteTasks?: boolean } = {},
): Promise<ActionResult> {
  const parsed = z
    .object({ id: z.string(), deleteTasks: z.boolean().optional() })
    .safeParse({ id, deleteTasks: opts.deleteTasks });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const userId = await requireUserId();
  const existing = await getProject(userId, id);
  if (!existing) return { ok: false, error: "Not found" };

  const goalId = existing.goalId;
  const deleted = await deleteProject(userId, id, {
    deleteTasks: parsed.data.deleteTasks,
  });
  if (!deleted) return { ok: false, error: "Not found" };

  // The project's own tags go with it — a flagship pointing at nothing would
  // be undeletable dead weight. Any other tag that had joined the project is
  // released back to being ordinary, since the user chose to create it.
  const projectTags = (await listTags(userId)).filter(
    (t) => t.projectId === id,
  );
  for (const tag of projectTags) {
    if (tag.isProjectPrimary) {
      await deleteTag(userId, tag.id);
    } else {
      await detachTagFromProject(userId, tag.id);
    }
  }

  if (goalId) await syncGoalProgress(userId, goalId);
  revalidatePath("/", "layout");
  return { ok: true };
}
