// Turning a scope into rows. Pure: hand it the lists, get the selection back.
//
// This is the half of the assistant that is NOT a model. Everything here runs
// the same way every time for the same input, which is the entire reason the
// scope exists as data rather than as a sentence the model wrote.
//
// Composed from the app's own filtering and sorting wherever they already
// exist — applyTaskFilters, sortTasks, sortNotes — so a list the assistant
// selects and the same list on its own page can never disagree about what
// "high priority, not done, oldest first" means.

import type { Goal, Habit, Note, Project, Task } from "@/lib/schemas";
import { applyTaskFilters, NO_FILTERS } from "@/lib/task-filters";
import { sortTasks, sortNotes, sortProjects } from "@/lib/collection-sort";
import { addDaysToIsoDate } from "@/lib/timezone";
import type {
  DateWindow,
  ResolvedScope,
  Scope,
  ScopeFilters,
  ScopeRow,
} from "@/lib/ai/scope-schema";

/**
 * The most rows one "all" can touch.
 *
 * Matches bulkUpdateTasks' own cap, so the assistant can never ask for more
 * than the action would accept. The screen says when it bites rather than
 * quietly acting on a prefix.
 */
export const ALL_CAP = 200;

/** How many cut-off rows the preview shows below the line. */
const EXCLUDED_PREVIEW = 4;

export type ScopeInput = {
  today: string;
  timeZone: string;
  tasks: Task[];
  habits: Habit[];
  goals: Goal[];
  projects: Project[];
  notes: Note[];
};

/**
 * Does an ISO date fall inside a named window?
 *
 * Windows are computed from the user's own today rather than from UTC — the
 * whole point of naming them instead of sending timestamps.
 */
export function inWindow(
  value: string | null | undefined,
  window: DateWindow,
  today: string,
  timeZone: string,
): boolean {
  if (window === "any") return true;
  const date = (value ?? "").slice(0, 10);
  if (window === "undated") return date === "";
  if (!date) return false;

  switch (window) {
    case "overdue":
      return date < today;
    case "today":
      return date === today;
    case "thisWeek":
      return date >= today && date <= addDaysToIsoDate(today, 7, timeZone);
    case "thisMonth":
      return date >= today && date <= addDaysToIsoDate(today, 30, timeZone);
  }
}

/**
 * A created-window is asked backwards from a due-window: "added this week"
 * means the last seven days, not the next seven.
 */
function createdInWindow(
  createdAt: string,
  window: DateWindow,
  today: string,
  timeZone: string,
): boolean {
  if (window === "any") return true;
  const date = (createdAt ?? "").slice(0, 10);
  if (!date) return false;
  switch (window) {
    case "today":
      return date === today;
    case "thisWeek":
      return date >= addDaysToIsoDate(today, -7, timeZone);
    case "thisMonth":
      return date >= addDaysToIsoDate(today, -30, timeZone);
    // "overdue" and "undated" say nothing about a creation date.
    default:
      return true;
  }
}

const hasText = (haystack: string, needle: string | null | undefined) =>
  !needle || haystack.toLowerCase().includes(needle.toLowerCase());

const hasAnyTag = (tagIds: string[], wanted: string[] | null | undefined) =>
  !wanted?.length || tagIds.some((id) => wanted.includes(id));

/**
 * lifeArea "both" means "do not filter", not "only things marked both".
 *
 * An entity marked "both" belongs to either side, so asking for work should
 * return it. Getting this backwards would silently drop every shared item.
 */
const inLifeArea = (
  area: string,
  wanted: string | null | undefined,
): boolean => {
  if (!wanted || wanted === "both") return true;
  return area === wanted || area === "both";
};

const inProgressRange = (progress: number, f: ScopeFilters) =>
  (f.progressBelow == null || progress < f.progressBelow) &&
  (f.progressAbove == null || progress > f.progressAbove);

const shared = (
  row: { tagIds: string[]; lifeArea: string; createdAt: string },
  title: string,
  f: ScopeFilters,
  today: string,
  timeZone: string,
) =>
  hasAnyTag(row.tagIds, f.tagIds) &&
  inLifeArea(row.lifeArea, f.lifeArea) &&
  hasText(title, f.contains) &&
  createdInWindow(row.createdAt, f.created ?? "any", today, timeZone);

/** dd MMM, the way the preview writes a date. */
function shortDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "";
  const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  return `${d} ${months[m - 1]}`;
}

const STATUS_WORD: Record<string, string> = {
  todo: "to do",
  doing: "in progress",
  done: "done",
};

/**
 * Resolve a scope to the rows it selects.
 *
 * The order of operations is the contract: filter, then sort, then cut. Doing
 * the cut before the sort would make "the oldest 3" mean "3 arbitrary ones,
 * sorted", which is exactly the class of bug this replaces.
 */
export function resolveScope(scope: Scope, input: ScopeInput): ResolvedScope {
  const { today, timeZone } = input;
  const f = scope.filters ?? {};
  let matched: ScopeRow[];

  switch (scope.entity) {
    case "task": {
      const filtered = applyTaskFilters(
        input.tasks.filter(
          (t) =>
            shared(t, t.title, f, today, timeZone) &&
            (f.projectId == null || t.projectId === f.projectId) &&
            (f.goalId == null || t.goalId === f.goalId) &&
            inWindow(t.due, f.due ?? "any", today, timeZone),
        ),
        {
          ...NO_FILTERS,
          status: f.status ?? [],
          priority: f.priority ?? [],
        },
        today,
      );
      const sorted = sortTasks(
        filtered,
        scope.sort.by === "due"
          ? "due"
          : scope.sort.by === "priority"
            ? "priority"
            : scope.sort.by === "alpha"
              ? "alpha"
              : "created",
        // sortTasks' "created" is newest-first, so ascending (oldest) IS the
        // reversed direction. Every other sort runs the way it reads.
        scope.sort.by === "created" ? !scope.sort.reversed : scope.sort.reversed,
      );
      matched = sorted.map((t) => ({
        id: t.id,
        title: t.title,
        detail: `added ${shortDate(t.createdAt)} · ${STATUS_WORD[t.status] ?? t.status}`,
        from: t.priority,
      }));
      break;
    }

    case "habit": {
      const rows = input.habits.filter(
        (h) =>
          shared(h, h.name, f, today, timeZone) &&
          // Archived defaults to "not archived": a bulk change should not
          // reach into things the user has already put away.
          h.archived === (f.archived ?? false) &&
          (!f.frequency?.length ||
            f.frequency.includes(
              h.frequency.type as "daily" | "weekly" | "monthly",
            )) &&
          (f.goalId == null || h.goalIds.includes(f.goalId)),
      );
      const sorted = [...rows].sort((a, b) =>
        scope.sort.by === "alpha"
          ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
          : a.createdAt.localeCompare(b.createdAt),
      );
      if (scope.sort.reversed) sorted.reverse();
      matched = sorted.map((h) => ({
        id: h.id,
        title: h.name,
        detail: `added ${shortDate(h.createdAt)} · ${h.frequency.type}`,
      }));
      break;
    }

    case "goal": {
      const rows = input.goals.filter(
        (g) =>
          shared(g, g.title, f, today, timeZone) &&
          (f.category == null || g.category === f.category) &&
          inProgressRange(g.progress, f) &&
          inWindow(g.targetDate, f.target ?? "any", today, timeZone),
      );
      const sorted = [...rows].sort((a, b) => {
        if (scope.sort.by === "alpha") {
          return a.title.localeCompare(b.title, undefined, {
            sensitivity: "base",
          });
        }
        if (scope.sort.by === "progress") return a.progress - b.progress;
        if (scope.sort.by === "target") {
          // Undated goals sink, the same way undated tasks do.
          if (!a.targetDate && !b.targetDate) return 0;
          if (!a.targetDate) return 1;
          if (!b.targetDate) return -1;
          return a.targetDate.localeCompare(b.targetDate);
        }
        return a.createdAt.localeCompare(b.createdAt);
      });
      if (scope.sort.reversed) sorted.reverse();
      matched = sorted.map((g) => ({
        id: g.id,
        title: g.title,
        detail: `${g.progress}% · ${g.category}`,
      }));
      break;
    }

    case "project": {
      const rows = input.projects.filter(
        (p) =>
          shared(p, p.title, f, today, timeZone) &&
          inProgressRange(p.progress, f),
      );
      const sorted = sortProjects(
        rows,
        scope.sort.by === "alpha"
          ? "alpha"
          : scope.sort.by === "progress"
            ? "progress"
            : "created",
        // sortProjects' "created" is newest-first, same inversion as tasks.
        scope.sort.by === "created" ? !scope.sort.reversed : scope.sort.reversed,
      );
      matched = sorted.map((p) => ({
        id: p.id,
        title: p.title,
        detail: `${p.progress}% · added ${shortDate(p.createdAt)}`,
      }));
      break;
    }

    case "note": {
      const rows = input.notes.filter(
        (n) =>
          shared(n, n.title, f, today, timeZone) &&
          (f.pinned == null || n.pinned === f.pinned) &&
          inWindow(n.updatedAt, f.edited ?? "any", today, timeZone),
      );
      const sorted = sortNotes(
        rows,
        scope.sort.by === "alpha"
          ? "alpha"
          : scope.sort.by === "created"
            ? "created"
            : "edited",
        // Both note orderings are newest-first natively.
        scope.sort.by === "alpha" ? scope.sort.reversed : !scope.sort.reversed,
      );
      matched = sorted.map((n) => ({
        id: n.id,
        title: n.title,
        detail: `edited ${shortDate(n.updatedAt)}`,
      }));
      break;
    }
  }

  const limit = scope.count === "all" ? ALL_CAP : scope.count;
  const selected = matched.slice(0, limit);
  return {
    ids: selected.map((r) => r.id),
    rows: selected,
    excluded: matched.slice(limit, limit + EXCLUDED_PREVIEW),
    matched: matched.length,
    capped: scope.count === "all" && matched.length > ALL_CAP,
  };
}
