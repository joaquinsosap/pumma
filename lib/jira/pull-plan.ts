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
  /** True when a project here already holds that ticket: the tasks go into it, and no second project is made. */
  existing: boolean;
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

/**
 * What is here already, by ticket number. Numbers and not links: the same
 * ticket can be linked by its page, a board with it open or a filter view,
 * and those are three different addresses.
 */
export type PullHave = {
  /** Tickets some task already links. */
  tasks: ReadonlySet<string>;
  /** Tickets some project was already made from. */
  projects: ReadonlySet<string>;
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
export function epicTagName(title: string, key?: string): string {
  // A title with no letter or digit the tag alphabet keeps (Cyrillic, emoji)
  // would make every such epic the same placeholder. Its number is at least its own.
  const plain = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (key && !/[a-z0-9]/i.test(plain)) return key.toLowerCase();
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
 * everything under it along. `have` says which tickets a task or a project
 * here already stands for, so nothing is made twice: a ticket already a task
 * is left out, and a ticket already a project gets its new tasks added to it.
 */
export function planPull(
  forest: PullForest,
  level: PullLevel,
  off: ReadonlySet<string>,
  have: PullHave,
): PullPlan {
  let alreadyHere = 0;
  const projects: PlannedProject[] = [];
  // Within one pull too: a ticket read twice (two searches naming it) is one task.
  const planned = new Set<string>();

  const tasksOf = (stories: PulledTicket[], tag: string | null) => {
    const made: PlannedTask[] = [];
    for (const story of stories) {
      if (off.has(story.key) || planned.has(story.key)) continue;
      if (have.tasks.has(story.key)) {
        alreadyHere += 1;
        continue;
      }
      planned.add(story.key);
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
    existing: have.projects.has(ticket.key),
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
      const tag = unused(epicTagName(epic.ticket.title, epic.ticket.key), taken);
      project.tags.push(tag);
      project.tasks.push(...tasksOf(epic.stories, tag));
    }
    projects.push(project);
  }

  // An epic with no COORD above it has nothing to be a tag of: it is the project, at either level.
  forest.epics.forEach(epicAsProject);

  const unfiled = tasksOf(forest.loose, null);
  if (unfiled.length > 0) {
    projects.push({ from: null, existing: false, title: null, tags: [], tasks: unfiled });
  }

  return { projects, alreadyHere };
}

/**
 * The line under the tree: how much "Bring in" will make. A project already
 * here is not made, so it is not counted, and neither are its epic tags: they
 * came with it the first time, and this rule cannot see the tags to know which
 * one is new. The count is a floor there; what was made is said afterwards.
 */
export function countPlan(plan: PullPlan): {
  projects: number;
  tags: number;
  tasks: number;
} {
  return {
    projects: plan.projects.filter((p) => p.from !== null && !p.existing).length,
    tags: plan.projects.reduce((n, p) => n + (p.existing ? 0 : p.tags.length), 0),
    tasks: plan.projects.reduce((n, p) => n + p.tasks.length, 0),
  };
}
