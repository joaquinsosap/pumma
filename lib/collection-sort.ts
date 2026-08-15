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
): Task[] {
  switch (sort) {
    case "priority":
      return sortTasksByPriority(tasks);
    case "custom":
      // The order the user made by dragging — what the kanban drop writes.
      return stable(tasks, (a, b) => a.order - b.order);
    case "due":
      // Soonest first; the undated sink to the bottom rather than pretending
      // to be due before everything.
      return stable(tasks, (a, b) => {
        if (!a.due && !b.due) return 0;
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
      });
    case "created":
      return stable(tasks, newest);
    case "alpha":
      return stable(tasks, byTitle);
  }
}

export function sortProjects(
  projects: Project[],
  sort: ProjectSort,
): Project[] {
  switch (sort) {
    case "created":
      return stable(projects, newest);
    case "alpha":
      return stable(projects, byTitle);
    case "progress":
      // Most finished first: the rail then reads as "closest to done".
      return stable(projects, (a, b) => b.progress - a.progress);
  }
}

/** Pinned notes stay on top whatever the sort — a pin outranks an ordering. */
export function sortNotes(notes: Note[], sort: NoteSort): Note[] {
  const cmp =
    sort === "edited"
      ? (a: Note, b: Note) =>
          a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0
      : sort === "created"
        ? newest
        : byTitle;
  return stable(
    notes,
    (a, b) => Number(b.pinned) - Number(a.pinned) || cmp(a, b),
  );
}

export function sortTags(
  tags: Tag[],
  sort: TagSort,
  usage?: Map<string, number>,
): Tag[] {
  switch (sort) {
    case "custom":
      return stable(tags, (a, b) => a.order - b.order);
    case "alpha":
      return stable(tags, (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    case "usage":
      return stable(
        tags,
        (a, b) => (usage?.get(b.id) ?? 0) - (usage?.get(a.id) ?? 0),
      );
    case "created":
      return stable(tags, newest);
  }
}
