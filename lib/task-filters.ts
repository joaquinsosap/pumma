import type { Task } from "@/lib/schemas";
import type { TaskStatus, TaskPriority } from "@/lib/types";

export const TASK_STATUSES: TaskStatus[] = ["todo", "doing", "done"];
export const TASK_PRIORITIES: TaskPriority[] = ["high", "med", "low"];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  doing: "In progress",
  done: "Done",
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "High",
  med: "Medium",
  low: "Low",
};

/**
 * The due facet asks about the deadline rather than the task: is it past, or
 * missing entirely? "Overdue" is the one slice the tabs cannot make — Today
 * and Upcoming both exclude the past by construction — and "No due date" is
 * its complement at the other end: the tasks that can never become overdue
 * because nobody gave them a chance to.
 */
export const TASK_DUE_FILTERS = ["overdue", "undated"] as const;
export type TaskDueFilter = (typeof TASK_DUE_FILTERS)[number];

export const DUE_LABELS: Record<TaskDueFilter, string> = {
  overdue: "Overdue",
  undated: "No due date",
};

export type TaskFilters = {
  status: TaskStatus[];
  priority: TaskPriority[];
  tagIds: string[];
  due: TaskDueFilter[];
};

export const NO_FILTERS: TaskFilters = {
  status: [],
  priority: [],
  tagIds: [],
  due: [],
};

/**
 * Overdue means the deadline is in the past AND the task is still open. A
 * done task with an old date is history, not a debt; showing it under
 * "overdue" would make finishing late indistinguishable from not finishing.
 */
export function isOverdue(task: Task, today: string): boolean {
  if (task.status === "done") return false;
  const d = (task.due ?? "").slice(0, 10);
  return d.length > 0 && d < today;
}

/**
 * Filter tasks by status, priority and tags.
 *
 * An empty list for a facet means "don't filter on it" rather than "match
 * nothing" — so an untouched filter is invisible, and ticking every box means
 * the same thing as ticking none.
 *
 * Facets are ANDed with each other and ORed within themselves: high-priority
 * tasks tagged work *or* health. Tag matching is "has any of", because a task
 * carrying every selected tag at once is almost never what someone means.
 */
export function applyTaskFilters(
  tasks: Task[],
  filters: TaskFilters,
  today = "",
): Task[] {
  const { status, priority, tagIds, due = [] } = filters;
  if (!status.length && !priority.length && !tagIds.length && !due.length) {
    return tasks;
  }

  const wantedTags = new Set(tagIds);
  return tasks.filter((task) => {
    if (status.length && !status.includes(task.status)) return false;
    if (priority.length && !priority.includes(task.priority)) return false;
    if (wantedTags.size && !task.tagIds.some((id) => wantedTags.has(id))) {
      return false;
    }
    if (due.length) {
      const matches =
        (due.includes("overdue") && isOverdue(task, today)) ||
        (due.includes("undated") && !task.due);
      if (!matches) return false;
    }
    return true;
  });
}

/** How many facet values are switched on — drives the badge on the trigger. */
export function countActiveFilters(filters: TaskFilters): number {
  return (
    filters.status.length +
    filters.priority.length +
    filters.tagIds.length +
    (filters.due?.length ?? 0)
  );
}

export function hasActiveFilters(filters: TaskFilters): boolean {
  return countActiveFilters(filters) > 0;
}

/** Toggle one value in a facet list, preserving the facet's canonical order. */
export function toggleFilterValue<T extends string>(
  current: T[],
  value: T,
  order?: readonly T[],
): T[] {
  const next = current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
  if (!order) return next;
  return order.filter((v) => next.includes(v));
}
