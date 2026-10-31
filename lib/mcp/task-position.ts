// Pure rules for a project task's place in its board column.
import { SORT_LABELS, sortTasks } from "@/lib/collection-sort";
import type { Settings, Task } from "@/lib/schemas";

/** A project's column for one status, in the order the board's Custom sort shows. */
export function columnOf(
  tasks: Task[],
  projectId: string,
  status: Task["status"],
): Task[] {
  return sortTasks(
    tasks.filter((t) => t.projectId === projectId && t.status === status),
    "custom",
  );
}

/** Each project task's place in its column, from 1. A task with no project has none. */
export function columnPositions(tasks: Task[]): Map<string, number> {
  const columns = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.projectId) continue;
    const key = `${t.projectId}/${t.status}`;
    const column = columns.get(key);
    if (column) column.push(t);
    else columns.set(key, [t]);
  }

  const positions = new Map<string, number>();
  for (const column of columns.values()) {
    sortTasks(column, "custom").forEach((t, i) => positions.set(t.id, i + 1));
  }
  return positions;
}

/** The column's ids with `id` right below `after`, or on top for null. Null when `after` isn't in the column. */
export function placeAfter(
  columnIds: string[],
  id: string,
  after: string | null,
): string[] | null {
  const rest = columnIds.filter((c) => c !== id);
  if (after === null) return [id, ...rest];
  const at = rest.indexOf(after);
  return at < 0 ? null : [...rest.slice(0, at + 1), id, ...rest.slice(at + 1)];
}

/** The writes that number a column from 0 in this order, as a board drop does. Rows already right are left out. */
export function orderPatches(
  column: Task[],
  ids: string[],
): { id: string; patch: { order: number } }[] {
  const current = new Map(column.map((t) => [t.id, t.order]));
  return ids.flatMap((id, order) =>
    current.get(id) === order ? [] : [{ id, patch: { order } }],
  );
}

/** Why a move may not show: the board only reads this order under Custom, running the normal way. */
export function boardNote(
  settings: Pick<Settings, "projectTaskSort" | "sortReversed">,
): string {
  if (settings.projectTaskSort !== "custom") {
    return `The board is sorted by ${SORT_LABELS[settings.projectTaskSort]} right now, so this shows once it is switched to Custom.`;
  }
  return settings.sortReversed.includes("projectTask")
    ? "The board runs Custom in reverse right now, so this shows upside down until that is turned off."
    : "";
}
