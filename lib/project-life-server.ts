import type { Tag } from "@/lib/schemas";
import type { LifeView } from "@/lib/types";
import { listTasks, updateTask } from "@/lib/db/tasks";
import { updateProject } from "@/lib/db/projects";
import { deriveLifeAreaFromTags, setLifeTags } from "@/lib/life-area-sync";

/**
 * Move a project — and everything filed under it — to a side of life.
 *
 * A project's tasks belong to it, so a project that becomes work with its
 * tasks left on personal would show up empty in the Work view and orphaned in
 * Personal. The tags are what every view filters on, so the cascade rewrites
 * those and lets lifeArea follow.
 */
export async function setProjectLifeArea(
  userId: string,
  project: { id: string; tagIds: string[] },
  view: LifeView,
  tags: Tag[],
): Promise<void> {
  const projectTagIds = setLifeTags(project.tagIds, view, tags);
  await updateProject(userId, project.id, {
    tagIds: projectTagIds,
    lifeArea: deriveLifeAreaFromTags(projectTagIds, tags),
  });

  const tasks = await listTasks(userId);
  for (const task of tasks) {
    if (task.projectId !== project.id) continue;
    const tagIds = setLifeTags(task.tagIds, view, tags);
    await updateTask(userId, task.id, {
      tagIds,
      lifeArea: deriveLifeAreaFromTags(tagIds, tags),
    });
  }
}
