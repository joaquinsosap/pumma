import type { Note, Project, Tag, Task } from "@/lib/schemas";
import { sortTasksByPriority } from "@/lib/task-order";

/**
 * How each list in the app can be ordered, and what each ordering means.
 *
 * One module rather than a sort dropdown per view, because the options ARE
 * the contract: a view offers exactly the orderings listed here, the setting
 * that remembers the choice is typed against the same list, and the tests
 * exercise the comparator the view will actually run.
 *
 * "custom" is only offered where the view has a way to arrange things by hand
 * (the kanban board, the tag list in Settings). A custom order with no way to
 * make one is a menu item that does nothing.
 *
 * Every non-custom sort here is stable on its input: ties keep the order the
 * caller passed, so switching sorts never shuffles rows it has no opinion on.
 */

export const TASK_SORTS = ["priority", "due", "created", "alpha"] as const;
export const PROJECT_TASK_SORTS = [
  "priority",
  "custom",
  "created",
  "alpha",
] as const;
export const PROJECT_SORTS = ["created", "alpha", "progress"] as const;
export const NOTE_SORTS = ["edited", "created", "alpha"] as const;
export const TAG_SORTS = ["custom", "alpha", "usage", "created"] as const;

export type TaskSort = (typeof TASK_SORTS)[number];
export type ProjectTaskSort = (typeof PROJECT_TASK_SORTS)[number];
export type ProjectSort = (typeof PROJECT_SORTS)[number];
export type NoteSort = (typeof NOTE_SORTS)[number];
export type TagSort = (typeof TAG_SORTS)[number];

/** What the menu shows for each option. Shared so every menu says it the same way. */
export const SORT_LABELS: Record<string, string> = {
  priority: "Priority",
  custom: "Custom",
  due: "Due date",
  created: "Newest",
  edited: "Last edited",
  alpha: "A to Z",
  usage: "Most used",
  progress: "Progress",
};

/**
 * Which lists are currently sorted the other way around.
 *
 * One persisted list rather than a boolean per view: a view is either in it
 * or not, toggling is add/remove, and adding a sixth sortable list someday
 * costs a union member instead of a schema field.
 */
export const SORT_REVERSIBLE = [
  "task",
  "projectTask",
  "project",
  "note",
  "tag",
] as const;
export type SortReversible = (typeof SORT_REVERSIBLE)[number];

/** The list with `key` present or absent — what a direction toggle persists. */
export function setReversedIn(
  current: readonly string[],
  key: SortReversible,
  on: boolean,
): SortReversible[] {
  const list = current.filter(
    (k): k is SortReversible =>
      (SORT_REVERSIBLE as readonly string[]).includes(k) && k !== key,
  );
  return on ? [...list, key] : list;
}

/**
 * A comparator turned around.
 *
 * The COMPARATOR flips, not the sorted array. Reversing the array would also
 * reverse every tie, so two undated tasks would swap places each time the
 * direction changed; and it would drag "special" rows along — pinned notes
 * sink to the bottom, the undated stop sinking. Flipping only the comparison
 * keeps ties stable and lets each sort keep its own exceptions on top.
 */
function turned<T>(
  cmp: (a: T, b: T) => number,
  reversed: boolean,
): (a: T, b: T) => number {
  return reversed ? (a, b) => -cmp(a, b) : cmp;
}

/** Stable sort: ties keep their incoming position. */
function stable<T>(items: T[], cmp: (a: T, b: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => cmp(a.item, b.item) || a.index - b.index)
    .map((e) => e.item);
}

const byTitle = (a: { title: string }, b: { title: string }) =>
  a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

/** Newest first. Dates are ISO strings, so string compare is date compare. */
const newest = (a: { createdAt: string }, b: { createdAt: string }) =>
  a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;

export function sortTasks(
  tasks: Task[],
  sort: TaskSort | ProjectTaskSort,
  reversed = false,
): Task[] {
  switch (sort) {
    case "priority": {
      const ordered = sortTasksByPriority(tasks);
      // Priority sorting is a pipeline, not one comparator, so the direction
      // is applied to its result. Ties inside a band keep their order either
      // way because the reversal is BY band: the bands swap, their contents
      // do not.
      return reversed ? reverseByKey(ordered, (t) => t.priority) : ordered;
    }
    case "custom":
      // The order the user made by dragging — what the kanban drop writes.
      return stable(tasks, turned((a, b) => a.order - b.order, reversed));
    case "due":
      // Soonest first; the undated sink to the bottom rather than pretending
      // to be due before everything — and they stay at the bottom reversed,
      // because "latest first" is a question about dates and they have none.
      return stable(tasks, (a, b) => {
        if (!a.due && !b.due) return 0;
        if (!a.due) return 1;
        if (!b.due) return -1;
        const c = a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
        return reversed ? -c : c;
      });
    case "created":
      return stable(tasks, turned(newest, reversed));
    case "alpha":
      return stable(tasks, turned(byTitle, reversed));
  }
}

/**
 * Reverse the order of GROUPS of equal keys while keeping each group's
 * internal order. [high, high, med, low] -> [low, med, high, high], with the
 * two highs still in the order the pipeline put them.
 */
function reverseByKey<T>(items: T[], key: (item: T) => string): T[] {
  const groups: T[][] = [];
  let prev: string | undefined;
  for (const item of items) {
    const k = key(item);
    if (k !== prev) groups.push([]);
    groups[groups.length - 1].push(item);
    prev = k;
  }
  return groups.reverse().flat();
}

export function sortProjects(
  projects: Project[],
  sort: ProjectSort,
  reversed = false,
): Project[] {
  switch (sort) {
    case "created":
      return stable(projects, turned(newest, reversed));
    case "alpha":
      return stable(projects, turned(byTitle, reversed));
    case "progress":
      // Most finished first: the rail then reads as "closest to done".
      return stable(projects, turned((a, b) => b.progress - a.progress, reversed));
  }
}

/** Pinned notes stay on top whatever the sort — a pin outranks an ordering. */
export function sortNotes(
  notes: Note[],
  sort: NoteSort,
  reversed = false,
): Note[] {
  const cmp =
    sort === "edited"
      ? (a: Note, b: Note) =>
          a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
      : sort === "created"
        ? newest
        : byTitle;
  // The pin term sits OUTSIDE the reversal: pins stay on top whichever way
  // the list runs, because a pin outranks an ordering in both directions.
  const inner = turned(cmp, reversed);
  return stable(
    notes,
    (a, b) => Number(b.pinned) - Number(a.pinned) || inner(a, b),
  );
}

export function sortTags(
  tags: Tag[],
  sort: TagSort,
  usage?: Map<string, number>,
  reversed = false,
): Tag[] {
  switch (sort) {
    case "custom":
      return stable(tags, turned((a, b) => a.order - b.order, reversed));
    case "alpha":
      return stable(
        tags,
        turned(
          (a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
          reversed,
        ),
      );
    case "usage":
      return stable(
        tags,
        turned((a, b) => (usage?.get(b.id) ?? 0) - (usage?.get(a.id) ?? 0), reversed),
      );
    case "created":
      return stable(tags, turned(newest, reversed));
  }
}
