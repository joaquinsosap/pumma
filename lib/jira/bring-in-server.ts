import "server-only";

import { listProjects } from "@/lib/db/projects";
import { insertTag, listTags } from "@/lib/db/tags";
import { insertTasks, listTasks } from "@/lib/db/tasks";
import { jiraKeyOn } from "@/lib/jira/address";
import { finishedDay, type PullHave, type PullPlan } from "@/lib/jira/pull-plan";
import { deriveLifeAreaFromTags, setLifeTags } from "@/lib/life-area-sync";
import { createProjectWithTag } from "@/lib/project-create-server";
import { projectTagSlug, uniqueTagName } from "@/lib/project-tags";
import { syncGoalsForProject } from "@/lib/goal-sync-server";
import type { Project, Tag } from "@/lib/schemas";
import { userToday } from "@/lib/timezone-server";

// Turning a confirmed pull into projects, tags and tasks.
//
// The plan says what to make (lib/jira/pull-plan). This file makes it, the way
// the rest of the app makes those things: a project through the one place that
// makes projects, so it has its own tag; a task wearing its project's tag, its
// epic's tag and the work tag. Everything from a tracker is work.

/** What is here already for the Jira at `baseUrl`, by ticket number, and which project stands for which ticket. */
export async function whatIsHere(
  userId: string,
  baseUrl: string,
): Promise<{ have: PullHave; projectOf: Map<string, Project> }> {
  const [tasks, projects] = await Promise.all([
    listTasks(userId),
    listProjects(userId),
  ]);
  const taskKeys = new Set<string>();
  for (const task of tasks) {
    const key = jiraKeyOn(baseUrl, task.ticketUrl);
    if (key) taskKeys.add(key);
  }
  const projectOf = new Map<string, Project>();
  for (const project of projects) {
    const key = jiraKeyOn(baseUrl, project.ticketUrl);
    if (key && !projectOf.has(key)) projectOf.set(key, project);
  }
  return {
    have: { tasks: taskKeys, projects: new Set(projectOf.keys()) },
    projectOf,
  };
}

export type Brought = {
  projects: number;
  tags: number;
  tasks: number;
  /** Tickets left out because a task here already holds them. */
  alreadyHere: number;
  /** The first project that got something, to open once it is done. Null when only loose tasks came in. */
  openProjectId: string | null;
};

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Make what `plan` says. `projectOf` is what stood here when the plan was
 * made: a ticket it names gets its tasks added to that project.
 */
export async function bringIn(
  userId: string,
  plan: PullPlan,
  projectOf: ReadonlyMap<string, Project>,
): Promise<Brought> {
  const { today, timeZone } = await userToday();
  // Kept by hand from here on: tags are made as the loop goes, and a second
  // read inside one request may hand back the list from before they existed.
  const known: Tag[] = [...(await listTags(userId))];
  const projects: Project[] = [...(await listProjects(userId))];
  const out: Brought = {
    projects: 0,
    tags: 0,
    tasks: 0,
    alreadyHere: plan.alreadyHere,
    openProjectId: null,
  };
  // Newest first is how a column sorts, so the first ticket takes the lowest place and the rest follow Jira's order.
  let place = -Date.now();
  // A tag stands for one epic. Two epics whose names collide must not end up sharing one found by its name.
  const taken = new Set<string>();
  // Projects that were here before and got tasks: a goal above one of them has to hear about it.
  const grown = new Set<string>();

  for (const planned of plan.projects) {
    let project: Project | null = null;
    let ownTagId: string | null = null;

    if (planned.from) {
      const here = projectOf.get(planned.from.key);
      if (here) {
        project = here;
        ownTagId =
          known.find((t) => t.projectId === here.id && t.isProjectPrimary)?.id ??
          null;
        if (!ownTagId) {
          // A bring-in that stopped between the project and its tag left it without one. Mend it here.
          const mended = await insertTag(
            userId,
            uniqueTagName(
              projectTagSlug(here.title),
              known.map((t) => t.name),
            ),
            { projectId: here.id, isProjectPrimary: true, color: here.color },
          );
          if (mended) {
            known.push(mended);
            ownTagId = mended.id;
          }
        }
      } else {
        const made = await createProjectWithTag(
          userId,
          {
            title: planned.title ?? planned.from.key,
            lifeArea: "work",
            ticketUrl: planned.from.url,
            adoptTag: false,
          },
          { tags: known, projects },
        );
        project = made.project;
        projects.push(made.project);
        out.projects += 1;
        if (made.ownTag) {
          ownTagId = made.ownTag.id;
          const at = known.findIndex((t) => t.id === made.ownTag!.id);
          if (at === -1) known.push(made.ownTag);
          else known[at] = made.ownTag;
        }
      }
    }

    // An epic's tag belongs to its project, so typing it on any task files the task there.
    const tagIdOf = new Map<string, string>();
    if (project) {
      for (const name of planned.tags) {
        // The same epic on an earlier pull: its tag, or the numbered one it got because the plain name was taken.
        const again = new RegExp(`^${escaped(name)}\\d*$`);
        const mine = known.find(
          (t) =>
            t.projectId === project!.id &&
            !t.isProjectPrimary &&
            !taken.has(t.id) &&
            again.test(t.name.toLowerCase()),
        );
        if (mine) {
          taken.add(mine.id);
          tagIdOf.set(name, mine.id);
          continue;
        }
        const made = await insertTag(
          userId,
          uniqueTagName(
            name,
            known.map((t) => t.name),
          ),
          { projectId: project.id, isProjectPrimary: false },
        );
        if (!made) continue;
        known.push(made);
        taken.add(made.id);
        tagIdOf.set(name, made.id);
        out.tags += 1;
      }
    }

    if (planned.tasks.length === 0) continue;
    const workTags = setLifeTags([], "work", known);
    const docs = planned.tasks.map((task) => {
      const epicTagId = task.tag ? tagIdOf.get(task.tag) : undefined;
      // A ticket that arrives done is history, dated where it happened at
      // both ends: made today and done last spring would count it in this
      // week's new tasks, and put the day it was made after the day it was done.
      const doneOn =
        task.status === "done" ? finishedDay(task.finished, today, timeZone) : null;
      const tagIds = [
        ...new Set([
          ...workTags,
          ...(ownTagId ? [ownTagId] : []),
          ...(epicTagId ? [epicTagId] : []),
        ]),
      ];
      return {
        userId,
        title: task.title,
        tagIds,
        priority: "med" as const,
        status: task.status,
        due: null,
        projectId: project?.id ?? null,
        goalId: null,
        lifeArea: deriveLifeAreaFromTags(tagIds, known),
        order: place++,
        createdAt: doneOn ?? today,
        completedAt: doneOn,
        ticketUrl: task.ticketUrl,
      };
    });
    await insertTasks(docs);
    out.tasks += docs.length;
    if (project && !out.openProjectId) out.openProjectId = project.id;
    if (project && planned.existing) grown.add(project.id);
  }
  // A goal's progress is stored, and worked out from the projects under it. A
  // project made just now has no goal yet; one that was here may.
  for (const projectId of grown) await syncGoalsForProject(userId, projectId);
  return out;
}
