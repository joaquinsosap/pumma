import type { Task } from "@/lib/schemas";
import type { TaskPriority } from "@/lib/types";
import { meetingSortKey } from "@/lib/calendar-tasks";

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, med: 1, low: 2 };

/** The due day as a sortable string; undated sorts after every real date. */
function dayKey(due: string | null): string {
  return due ? due.slice(0, 10) : "\uffff";
}

/**
 * Order tasks by priority, highest first.
 *
 * Strictly by priority — done tasks are NOT sunk to the bottom. Sinking them
 * split the list into two priority runs, so a MID sitting under a LOW read as
 * a broken sort even though both runs were ordered. The strikethrough already
 * says a task is finished; the order shouldn't have to say it twice.
 *
 * Within a priority band tasks run by day, then by hour: an Oct 20 14:00 sits
 * above an Oct 21 09:00, a timed task leads the untimed ones on its day, and
 * undated tasks go last. Ties hold the order they arrived in, since the sort is
 * stable.
 */
export function sortTasksByPriority(tasks: Task[]): Task[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => {
      const rankDelta =
        PRIORITY_RANK[a.task.priority] - PRIORITY_RANK[b.task.priority];
      if (rankDelta) return rankDelta;

      const dayA = dayKey(a.task.due);
      const dayB = dayKey(b.task.due);
      if (dayA !== dayB) return dayA < dayB ? -1 : 1;

      const timeDelta = meetingSortKey(a.task.due) - meetingSortKey(b.task.due);
      if (timeDelta) return timeDelta;

      return a.index - b.index;
    })
    .map((entry) => entry.task);
}
