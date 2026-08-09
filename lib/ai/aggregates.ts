// Precomputed statistics for the assistant. The model picks the framing and
// the widget; the arithmetic happens here, in code — models miscount, and a
// chart makes a wrong number look authoritative.
//
// Pure functions over plain rows. No db, no AI, unit-testable.
import { streakOf, bestStreak } from "@/lib/date";
import { addDaysToIsoDate } from "@/lib/timezone";

type TaskRow = {
  status: "todo" | "doing" | "done";
  priority: "low" | "med" | "high";
  due: string | null;
  lifeArea: string;
  projectId: string | null;
  tagIds: string[];
  createdAt: string;
  completedAt: string | null;
  timeSpentSec: number;
};

type HabitRow = {
  id: string;
  name: string;
  archived: boolean;
};

type EntryRow = { habitId: string; date: string };

type ProjectRow = { id: string; title: string; progress: number };
type GoalRow = {
  id: string;
  title: string;
  progress: number;
  targetDate: string | null;
};
type TagRow = { id: string; name: string };

export type SnapshotAggregates = ReturnType<typeof buildAggregates>;

const WEEKS = 12;

/**
 * Everything a "how am I doing" question needs, already counted.
 *
 * Weeks are ISO-ish buckets keyed by their start date (the user's week-start
 * setting is deliberately ignored here: buckets only need to be consistent
 * with each other, and Monday keeps them comparable across accounts).
 */
export function buildAggregates(input: {
  tasks: TaskRow[];
  habits: HabitRow[];
  entries: EntryRow[];
  projects: ProjectRow[];
  goals: GoalRow[];
  tags: TagRow[];
  today: string;
  timezone: string;
}) {
  const { tasks, habits, entries, projects, goals, tags, today, timezone } =
    input;

  const open = tasks.filter((t) => t.status !== "done");
  const done = tasks.filter((t) => t.status === "done");
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const projectTitle = new Map(projects.map((p) => [p.id, p.title]));

  // --- counts ---------------------------------------------------------------
  const byStatus = { todo: 0, doing: 0, done: 0 };
  const byPriority = { low: 0, med: 0, high: 0 };
  const byLife: Record<string, number> = {};
  const openByProject: Record<string, number> = {};
  const openByTag: Record<string, number> = {};
  let overdue = 0;
  let dueToday = 0;
  let unfiled = 0;

  for (const t of tasks) {
    byStatus[t.status]++;
    if (t.status !== "done") {
      byPriority[t.priority]++;
      byLife[t.lifeArea] = (byLife[t.lifeArea] ?? 0) + 1;
      if (t.due && t.due < today) overdue++;
      if (t.due === today) dueToday++;
      if (t.projectId) {
        const key = projectTitle.get(t.projectId) ?? "unknown";
        openByProject[key] = (openByProject[key] ?? 0) + 1;
      } else {
        unfiled++;
      }
      for (const id of t.tagIds) {
        const name = tagName.get(id);
        if (name) openByTag[name] = (openByTag[name] ?? 0) + 1;
      }
    }
  }

  // --- completions over time ------------------------------------------------
  // Buckets are trailing 7-day windows ending today, newest last, so "this
  // week" is always the final entry regardless of the calendar.
  //
  // Anchored to the caller's `today`, not the server's clock: everything else
  // in this snapshot is (dueToday, overdue, streaks), and mixing the two puts
  // the chart a day out of step with the numbers beside it whenever the two
  // disagree — which they do for every user whose evening is the server's
  // tomorrow.
  const completionsByWeek: {
    weekEnd: string;
    created: number;
    completed: number;
  }[] = [];
  for (let w = WEEKS - 1; w >= 0; w--) {
    const end = addDaysToIsoDate(today, -7 * w, timezone);
    const start = addDaysToIsoDate(today, -7 * (w + 1) + 1, timezone);
    completionsByWeek.push({
      weekEnd: end,
      created: tasks.filter((t) => t.createdAt >= start && t.createdAt <= end)
        .length,
      completed: done.filter(
        (t) => (t.completedAt ?? "") >= start && (t.completedAt ?? "") <= end,
      ).length,
    });
  }

  // --- time tracked ---------------------------------------------------------
  const timeByProject: Record<string, number> = {};
  let timeTotalSec = 0;
  for (const t of tasks) {
    if (!t.timeSpentSec) continue;
    timeTotalSec += t.timeSpentSec;
    const key = t.projectId
      ? (projectTitle.get(t.projectId) ?? "unknown")
      : "unfiled";
    timeByProject[key] = (timeByProject[key] ?? 0) + t.timeSpentSec;
  }

  // --- habits ---------------------------------------------------------------
  const entriesByHabit = new Map<string, Set<string>>();
  for (const e of entries) {
    let set = entriesByHabit.get(e.habitId);
    if (!set) entriesByHabit.set(e.habitId, (set = new Set()));
    set.add(e.date);
  }
  const habitStats = habits
    .filter((h) => !h.archived)
    .map((h) => {
      const set = entriesByHabit.get(h.id) ?? new Set<string>();
      // Same reason as the week buckets: `today` is the user's, the clock is
      // the server's, and streakOf on the line below already uses `today`.
      const last30 = addDaysToIsoDate(today, -30, timezone);
      return {
        name: h.name,
        streak: streakOf(set, today, timezone),
        best: bestStreak(set),
        last30: [...set].filter((d) => d >= last30).length,
      };
    });

  // --- projects: staleness --------------------------------------------------
  const projectStats = projects.map((p) => {
    const mine = tasks.filter((t) => t.projectId === p.id);
    const lastDone = mine
      .map((t) => t.completedAt ?? "")
      .filter(Boolean)
      .sort()
      .at(-1);
    return {
      title: p.title,
      progress: p.progress,
      openTasks: mine.filter((t) => t.status !== "done").length,
      // Days since something was finished in it; null = nothing ever finished.
      idleDays: lastDone ? daysBetween(lastDone.slice(0, 10), today) : null,
    };
  });

  return {
    tasks: {
      byStatus,
      openByPriority: byPriority,
      openByLifeArea: byLife,
      openByProject,
      openByTag,
      overdue,
      dueToday,
      unfiled,
      open: open.length,
      total: tasks.length,
    },
    completionsByWeek,
    time: {
      totalHours: round1(timeTotalSec / 3600),
      byProjectHours: Object.fromEntries(
        Object.entries(timeByProject).map(([k, v]) => [k, round1(v / 3600)]),
      ),
    },
    habits: habitStats,
    projects: projectStats,
    goals: goals.map((g) => ({
      title: g.title,
      progress: g.progress,
      targetDate: g.targetDate,
    })),
  };
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
