import "server-only";

import { insertProject, listProjects } from "@/lib/db/projects";
import { insertTag, listTags, setTagProject } from "@/lib/db/tags";
import {
  deriveLifeAreaFromTags,
  isLifeTag,
  setLifeTags,
} from "@/lib/life-area-sync";
import { pickProjectColor } from "@/lib/project-colors";
import { fileTaggedTasksIntoProject } from "@/lib/project-filing-server";
import { projectTagSlug, uniqueTagName } from "@/lib/project-tags";
import type { Project, Tag } from "@/lib/schemas";
import { userToday } from "@/lib/timezone-server";

// Making a project, with the tag that files things into it. One place for it:
// the New project card, the capture bar and a pull from Jira all make a
// project the same way, and none of them may make one without its tag.

export type CreatedProject = {
  project: Project;
  /** Set when the project's own tag was an existing tag rather than a new one. */
  adopted: { tagName: string; filed: number } | null;
  /** The project's own tag, which every task in it wears, as it stands now. Null only if the tag could not be made. */
  ownTag: Tag | null;
};

export async function createProjectWithTag(
  userId: string,
  input: {
    title: string;
    lifeArea?: "personal" | "work";
    color?: string;
    /** The ticket the project is made from, for one brought in from a tracker. */
    ticketUrl?: string | null;
  },
  /**
   * The tags and projects as the caller knows them. Only for a caller that
   * makes several in one go: a list read again inside the same request can
   * come back as it was before the first one was made.
   */
  known?: { tags: Tag[]; projects: Project[] },
): Promise<CreatedProject> {
  const { today: createdAt } = await userToday();
  const existing = known?.projects ?? (await listProjects(userId));
  // The project carries its own life tags: the side of life it is on is read
  // from them, never from a separate field.
  const allTags = known?.tags ?? (await listTags(userId));
  const projectTagIds = setLifeTags([], input.lifeArea ?? "personal", allTags);
  const project = await insertProject({
    userId,
    title: input.title,
    description: "",
    color: input.color ?? pickProjectColor(existing),
    progress: 0,
    label: "0/0",
    goalId: null,
    tagIds: projectTagIds,
    lifeArea: deriveLifeAreaFromTags(projectTagIds, allTags),
    createdAt,
    ticketUrl: input.ticketUrl ?? null,
  });

  // Every project gets a tag named after it, so "#wr" on a task is enough to
  // file it here. It is the hint that this works at all.
  const slug = projectTagSlug(input.title);
  const match = allTags.find((t) => t.name.toLowerCase() === slug);
  // A tag by that name already meaning this work is the whole point: adopt it
  // rather than making a near-identical twin, and bring what it holds along.
  // A tag another project owns cannot be taken, so that one gets a number.
  const adoptable = match && !match.projectId && !isLifeTag(match.name);

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
    return {
      project,
      adopted: { tagName: match.name, filed },
      ownTag: { ...match, projectId: project.id, isProjectPrimary: true },
    };
  }
  const made = await insertTag(
    userId,
    uniqueTagName(
      slug,
      allTags.map((t) => t.name),
    ),
    { projectId: project.id, isProjectPrimary: true, color: project.color },
  );
  return { project, adopted: null, ownTag: made };
}
