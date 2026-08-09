import type { Project, Tag } from "@/lib/schemas";
import { listTasks, updateTask } from "@/lib/db/tasks";
import {
  deriveLifeAreaFromTags,
  withProjectLifeTags,
} from "@/lib/life-area-sync";
import { withSingleProjectTag } from "@/lib/project-tags";
import { syncGoalsForProject } from "@/lib/goal-sync-server";

/**
 * File the tasks already carrying `tagId` into the project that tag now
 * belongs to.
 *
 * When a tag becomes a project's tag, everything wearing it was already about
 * that work — leaving those tasks unfiled would mean the tag files future
 * captures but not the ones that motivated making it a project.
 *
 * Only unfiled tasks move. A task already in another project is somewhere its
 * owner put it deliberately, and one tag arriving late is not a reason to
 * overrule that.
 */
export async function fileTaggedTasksIntoProject(
  userId: string,
  project: Project,
  tagId: string,
  tags: Tag[],
): Promise<number> {
  const tasks = await listTasks(userId);
  let filed = 0;

  for (const task of tasks) {
    if (!task.tagIds.includes(tagId)) continue;
    if (task.projectId) continue;

    // The tag is the project's now, so it survives the single-project rule;
    // the task takes the project's side of life along with its filing.
    const tagIds = withProjectLifeTags(
      withSingleProjectTag(task.tagIds, project.id, tags),
      project.lifeArea,
      tags,
    );
    await updateTask(userId, task.id, {
      projectId: project.id,
      tagIds,
      lifeArea: deriveLifeAreaFromTags(tagIds, tags),
    });
    filed++;
  }

  if (filed) await syncGoalsForProject(userId, project.id);
  return filed;
}
