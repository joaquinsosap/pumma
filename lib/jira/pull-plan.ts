// What a pull from Jira would make here, worked out before anything is made.
//
// Jira's own shape is COORD, then Epic, then Story. Which of those becomes a
// project is the owner's call, per pull:
//
//   - the COORD: one project, each epic under it a tag that splits its tasks;
//   - each epic: a project of its own, and no epic tags at all.
//
// Either way a story (or task, or bug) becomes a task that keeps its ticket's
// link. This file is only the rule. It reads nothing and writes nothing, so
// the screen can show exactly what "Bring in" will do, and the server can do
// exactly what the screen showed.

import type { JiraStage } from "@/lib/jira/issue";
import { isReservedTagName } from "@/lib/omni-reserved";
import { PROJECT_TITLE_MAX } from "@/lib/project-created";
import { projectTagSlug } from "@/lib/project-tags";

/** A ticket as a pull sees it: enough to place it and to make something of it. */
export type PulledTicket = {
  /** "VST-221" */
  key: string;
  title: string;
  /** Where it stands in Jira's three buckets. Null when Jira did not say. */
  stage: JiraStage | null;
  /** Its page on the connected Jira. This is what makes a task "the same ticket" on a later pull. */
  url: string;
};

export type PulledEpic = { ticket: PulledTicket; stories: PulledTicket[] };

/** Everything one pull read, hung the way Jira hangs it. */
export type PullForest = {
  coords: { ticket: PulledTicket; epics: PulledEpic[] }[];
  /** Epics with no COORD above them. */
  epics: PulledEpic[];
  /** Tickets with no epic above them. */
  loose: PulledTicket[];
};

export type PullLevel = "coord" | "epic";

export type PlannedTask = {
  title: string;
  ticketUrl: string;
  status: "todo" | "doing" | "done";
  /** The epic's tag, when the project is a COORD. Null otherwise. */
  tag: string | null;
};

export type PlannedProject = {
  /** The ticket that becomes the project. Null for tickets that land outside any project. */
  from: PulledTicket | null;
  /** Null together with `from`: these tasks are made unfiled. */
  title: string | null;
  /** Epic tags this project gets, in Jira's order. Empty unless the project is a COORD. */
  tags: string[];
  tasks: PlannedTask[];
};

export type PullPlan = {
  projects: PlannedProject[];
  /** Tickets left out because a task here already holds their link. */
  alreadyHere: number;
};

/** A tag made from an epic's title is cut near this length, at a word. Longer than a usual tag, shorter than a project's own. */
export const EPIC_TAG_MAX = 27;
const TASK_TITLE_MAX = 200;

const STATUS: Record<JiraStage, PlannedTask["status"]> = {
  todo: "todo",
  doing: "doing",
  done: "done",
};

/**
 * The tag an epic becomes: its title as a tag, cut at a word so it stays
 * readable. A first word longer than the limit is cut where the limit falls,
 * since there is no better place.
 */
export function epicTagName(title: string): string {
  const slug = projectTagSlug(title);
  let name = slug;
  if (slug.length > EPIC_TAG_MAX) {
    const cut = slug.slice(0, EPIC_TAG_MAX + 1).lastIndexOf("-");
    name = cut > 0 ? slug.slice(0, cut) : slug.slice(0, EPIC_TAG_MAX);
  }
  // "#today" or "#high" would be eaten by the capture bar every time it was typed.
  return isReservedTagName(name) ? `${name}-epic` : name;
}

/** A name not yet used in this plan, by numbering: two epics may share a title, or be cut to the same words. */
function unused(name: string, taken: Set<string>): string {
  let pick = name;
  for (let n = 2; taken.has(pick); n++) pick = `${name}-${n}`;
  taken.add(pick);
  return pick;
}

const clip = (text: string, max: number) => text.trim().slice(0, max).trim();

/**
 * The tickets a pull starts with unticked: the ones already done in Jira.
 * Bringing a year-old COORD in should not fill Done with its history. They
 * stay in the tree, so any of them can be ticked back.
 */
export function doneByDefault(forest: PullForest): string[] {
  const all = [
    ...forest.coords.flatMap((c) => c.epics.flatMap((e) => e.stories)),
    ...forest.epics.flatMap((e) => e.stories),
    ...forest.loose,
  ];
  return all.filter((t) => t.stage === "done").map((t) => t.key);
}

/**
 * What bringing `forest` in would make.
 *
 * `off` holds the keys unticked in the tree: an unticked COORD or epic takes
 * everything under it along. `linked` holds the ticket links tasks here
 * already carry, so a ticket is never made twice.
 */
export function planPull(
  forest: PullForest,
  level: PullLevel,
  off: ReadonlySet<string>,
  linked: ReadonlySet<string>,
): PullPlan {
  let alreadyHere = 0;
  const projects: PlannedProject[] = [];

  const tasksOf = (stories: PulledTicket[], tag: string | null) => {
    const made: PlannedTask[] = [];
    for (const story of stories) {
      if (off.has(story.key)) continue;
      if (linked.has(story.url)) {
        alreadyHere += 1;
        continue;
      }
      made.push({
        title: clip(story.title, TASK_TITLE_MAX) || story.key,
        ticketUrl: story.url,
        status: story.stage ? STATUS[story.stage] : "todo",
        tag,
      });
    }
    return made;
  };

  const projectFrom = (ticket: PulledTicket): PlannedProject => ({
    from: ticket,
    title: clip(ticket.title, PROJECT_TITLE_MAX) || ticket.key,
    tags: [],
    tasks: [],
  });

  const epicAsProject = (epic: PulledEpic) => {
    if (off.has(epic.ticket.key)) return;
    const project = projectFrom(epic.ticket);
    project.tasks = tasksOf(epic.stories, null);
    projects.push(project);
  };

  for (const coord of forest.coords) {
    if (off.has(coord.ticket.key)) continue;
    if (level === "epic") {
      coord.epics.forEach(epicAsProject);
      continue;
    }
    const project = projectFrom(coord.ticket);
    const taken = new Set<string>();
    for (const epic of coord.epics) {
      if (off.has(epic.ticket.key)) continue;
      const tag = unused(epicTagName(epic.ticket.title), taken);
      project.tags.push(tag);
      project.tasks.push(...tasksOf(epic.stories, tag));
    }
    projects.push(project);
  }

  // An epic with no COORD above it has nothing to be a tag of: it is the project, at either level.
  forest.epics.forEach(epicAsProject);

  const unfiled = tasksOf(forest.loose, null);
  if (unfiled.length > 0) {
    projects.push({ from: null, title: null, tags: [], tasks: unfiled });
  }

  return { projects, alreadyHere };
}

/** The line under the tree: how much "Bring in" will make. */
export function countPlan(plan: PullPlan): {
  projects: number;
  tags: number;
  tasks: number;
} {
  return {
    projects: plan.projects.filter((p) => p.from !== null).length,
    tags: plan.projects.reduce((n, p) => n + p.tags.length, 0),
    tasks: plan.projects.reduce((n, p) => n + p.tasks.length, 0),
  };
}
