import { listTasks } from "@/lib/db/tasks";
import { listHabits } from "@/lib/db/habits";
import { listHabitEntries } from "@/lib/db/habitEntries";
import { listGoals } from "@/lib/db/goals";
import { listProjects } from "@/lib/db/projects";
import { listTags } from "@/lib/db/tags";
import { listAgenda } from "@/lib/db/agenda";
import { listNotes } from "@/lib/db/notes";
import { getUser } from "@/lib/db/users";
import { getSettings } from "@/lib/db/settings";
import { LIFE_SPAN_DEFAULT } from "@/lib/life-constants";
import {
  dayDonePercent,
  openTaskCount,
  habitsDoneToday,
  topStreak,
} from "@/lib/metrics";
import { iso } from "@/lib/date";
import { habitStreak, normalizeHabitFrequency } from "@/lib/habit-visibility";
import { resolveTimezoneFromSettings } from "@/lib/timezone-server";
import { computeGoalProgress } from "@/lib/goal-sync";
import {
  DEFAULT_LIFE_VIEW,
  filterByLifeView,
  filterGoalsByLifeView,
  type LifeView,
} from "@/lib/life-area";
import { cache } from "react";
import { requireUserId } from "@/lib/auth/session";
import type { Settings } from "@/lib/schemas";

export type LoadAppDataOptions = {
  lifeView?: LifeView;
};

type CoreCollections = {
  allTasks: Awaited<ReturnType<typeof listTasks>>;
  allHabits: Awaited<ReturnType<typeof listHabits>>;
  allHabitEntries: Awaited<ReturnType<typeof listHabitEntries>>;
  allGoals: Awaited<ReturnType<typeof listGoals>>;
  allProjects: Awaited<ReturnType<typeof listProjects>>;
  tags: Awaited<ReturnType<typeof listTags>>;
  allNotes: Awaited<ReturnType<typeof listNotes>>;
  allAgenda: Awaited<ReturnType<typeof listAgenda>>;
  user: Awaited<ReturnType<typeof getUser>>;
  settings: Awaited<ReturnType<typeof getSettings>>;
};

/**
 * Shared DB reads — deduped (React cache) across the layout shell + the page in
 * one request, and issued as a SINGLE parallel batch. Everything a page needs
 * (incl. habit entries + agenda) is fetched here so the page itself does no extra
 * round-trip after the layout — important over high-latency links / VPNs.
 */
const fetchCoreCollections = cache(
  async (userId: string): Promise<CoreCollections> => {
    if (process.env.DATA_SOURCE === "mongodb") {
      const { warmMongoConnection } = await import("@/lib/mongodb");
      await warmMongoConnection();
    }

    const [
      allTasks,
      allHabits,
      allHabitEntries,
      allGoals,
      allProjects,
      tags,
      allNotes,
      allAgenda,
      user,
      settings,
    ] = await Promise.all([
      listTasks(userId),
      listHabits(userId),
      listHabitEntries(userId),
      listGoals(userId),
      listProjects(userId),
      listTags(userId),
      listNotes(userId),
      listAgenda(userId),
      getUser(userId),
      getSettings(userId),
    ]);
    return {
      allTasks,
      allHabits,
      allHabitEntries,
      allGoals,
      allProjects,
      tags,
      allNotes,
      allAgenda,
      user,
      settings,
    };
  },
);

function shellFromCore(
  core: CoreCollections,
  lifeView: LifeView,
  timezone: string,
) {
  const tasks = filterByLifeView(core.allTasks, lifeView);
  const habits = filterByLifeView(core.allHabits, lifeView);
  const projects = filterByLifeView(core.allProjects, lifeView);
  const notes = filterByLifeView(core.allNotes, lifeView);
  // Goals were the one collection left out of this, so switching to Work still
  // showed every personal goal. They filter on their category rather than the
  // shared lifeArea field — see goalLifeArea.
  const goals = filterGoalsByLifeView(core.allGoals, lifeView);

  return {
    tasks,
    allTasks: tasks,
    habits,
    goals,
    projects,
    tags: core.tags,
    notes,
    user: core.user,
    settings: core.settings,
    lifeView,
    timezone,
    counts: {
      openTasks: openTaskCount(tasks),
      notes: notes.length,
      habits: habits.length,
      goals: goals.length,
      projects: projects.length,
    },
    birthDate: core.settings?.birthDate ?? null,
    lifeSpanYears: core.settings?.lifeSpanYears ?? LIFE_SPAN_DEFAULT,
  };
}

/** Lightweight data for the app shell (sidebar, omnibar). Skips habit entries, agenda, stats. */
const loadShellDataForView = cache(async (lifeView: LifeView) => {
  const userId = await requireUserId();
  const core = await fetchCoreCollections(userId);
  const timezone = await resolveTimezoneFromSettings(core.settings);
  return shellFromCore(core, lifeView, timezone);
});

const loadAppDataForView = cache(async (lifeView: LifeView) => {
  const userId = await requireUserId();
  const core = await fetchCoreCollections(userId);
  const allHabitEntries = core.allHabitEntries;
  const allAgenda = core.allAgenda;
  const timezone = await resolveTimezoneFromSettings(core.settings);

  const shell = shellFromCore(core, lifeView, timezone);
  const { tasks, habits, goals } = shell;

  // Only the goals in view get shown, but their progress still rolls up from
  // every linked project, habit and task — a work project feeding a personal
  // goal still counts while you're looking at Personal.
  const goalsWithProgress = goals.map((g) => ({
    ...g,
    progress:
      computeGoalProgress(
        g.id,
        core.allProjects,
        core.allHabits,
        allHabitEntries,
        core.allTasks,
      ) ?? g.progress,
  }));

  const habitIds = new Set(habits.map((h) => h.id));
  const habitEntries = allHabitEntries.filter((e) => habitIds.has(e.habitId));
  const agenda = filterByLifeView(allAgenda, lifeView);

  const td = iso(new Date(), timezone);
  const carryover = filterByLifeView(
    core.allTasks.filter(
      (t) =>
        t.status !== "done" &&
        (t.due ?? "") !== "" &&
        (t.due ?? "").slice(0, 10) < td,
    ),
    lifeView,
  );

  return {
    ...shell,
    goals: goalsWithProgress,
    habitEntries,
    agenda,
    today: td,
    todayTasks: tasks.filter((t) => (t.due ?? "").slice(0, 10) === td),
    carryover,
    stats: {
      dayPct: dayDonePercent(tasks, habits, habitEntries, td),
      habitsLabel: habitsDoneToday(habits, habitEntries, td).label,
      topStreak: topStreak(habits, habitEntries, (set, h) =>
        // Compare like with like: a weekly habit's streak counts weeks.
        habitStreak(
          normalizeHabitFrequency(h.frequency.type),
          set,
          core.settings?.weekStart ?? "mon",
          td,
          h.frequency,
        ),
      ),
    },
  };
});

export async function loadShellData(options: LoadAppDataOptions = {}) {
  return loadShellDataForView(options.lifeView ?? DEFAULT_LIFE_VIEW);
}

export async function loadAppData(options: LoadAppDataOptions = {}) {
  return loadAppDataForView(options.lifeView ?? DEFAULT_LIFE_VIEW);
}

export type ShellData = Awaited<ReturnType<typeof loadShellData>>;
export type AppData = Awaited<ReturnType<typeof loadAppData>>;
export type AppSettings = Settings | null;
