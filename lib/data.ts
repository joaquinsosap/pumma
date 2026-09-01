import { listTasks } from "@/lib/db/tasks";
import { listHabits } from "@/lib/db/habits";
import { listHabitEntries } from "@/lib/db/habitEntries";
import { listGoals } from "@/lib/db/goals";
import { listProjects } from "@/lib/db/projects";
import { listTags } from "@/lib/db/tags";
import { listAgenda } from "@/lib/db/agenda";
import {
  listExternalEventBodies,
  listExternalEvents,
  listFeeds,
} from "@/lib/db/calendar-feeds";
import { externalToAgenda, type AgendaEntry } from "@/lib/linked-agenda";
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
  calendarFeeds: Awaited<ReturnType<typeof listFeeds>>;
  user: Awaited<ReturnType<typeof getUser>>;
  settings: Awaited<ReturnType<typeof getSettings>>;
};

/**
 * Shared DB reads — deduped (React cache) across the layout shell + the page in
 * one request, and issued as a SINGLE parallel batch, so the page does no extra
 * round-trip after the layout. That matters over a high-latency link.
 *
 * Meetings are deliberately NOT here. Two of the ten pages render an agenda,
 * and the events are by far the heaviest thing we store, so the other eight
 * were paying for a megabyte they threw away. See fetchAgenda.
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
      calendarFeeds,
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
      listFeeds(userId),
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
      calendarFeeds,
      user,
      settings,
    };
  },
);

/**
 * Your meetings AND the ones mirrored from subscribed calendars.
 *
 * Merged here rather than per page: every surface that already knows how to
 * draw a meeting then draws these too without being told they exist, which is
 * the whole point of mirroring them into the same shape.
 *
 * Separate from the core batch because it is the expensive read and almost
 * nothing needs it. `calendarFeeds` comes from the core batch, which is
 * already in flight by the time this runs, so asking for it again costs
 * nothing — React's cache hands back the same promise.
 */
const fetchAgenda = cache(async (userId: string): Promise<AgendaEntry[]> => {
  const [ownAgenda, externalEvents, core] = await Promise.all([
    listAgenda(userId),
    listExternalEvents(userId),
    fetchCoreCollections(userId),
  ]);
  return [
    ...ownAgenda,
    ...externalToAgenda(externalEvents, core.calendarFeeds),
  ];
});

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
    calendarFeeds: core.calendarFeeds,
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

/**
 * Everything loadAppData has, plus the meetings — for the two surfaces that
 * draw an agenda.
 *
 * `bodies` holds the invite text for `bodyDate` only, keyed by event id: a
 * body is two or three kilobytes and only the day on screen ever renders one.
 * The rest arrive from meetingBodiesAction as the user moves between days.
 */
const loadAgendaDataForView = cache(
  async (lifeView: LifeView, bodyDate: string) => {
    const base = await loadAppDataForView(lifeView);
    const userId = await requireUserId();
    const day = bodyDate || base.today;
    const [all, bodies] = await Promise.all([
      fetchAgenda(userId),
      listExternalEventBodies(userId, day, day),
    ]);
    return {
      ...base,
      agenda: filterByLifeView(all, lifeView),
      bodies,
    };
  },
);

export async function loadShellData(options: LoadAppDataOptions = {}) {
  return loadShellDataForView(options.lifeView ?? DEFAULT_LIFE_VIEW);
}

export async function loadAppData(options: LoadAppDataOptions = {}) {
  return loadAppDataForView(options.lifeView ?? DEFAULT_LIFE_VIEW);
}

export async function loadAgendaData(
  options: LoadAppDataOptions & { bodyDate?: string } = {},
) {
  return loadAgendaDataForView(
    options.lifeView ?? DEFAULT_LIFE_VIEW,
    options.bodyDate ?? "",
  );
}

export type ShellData = Awaited<ReturnType<typeof loadShellData>>;
export type AppData = Awaited<ReturnType<typeof loadAppData>>;
export type AgendaData = Awaited<ReturnType<typeof loadAgendaData>>;
export type AppSettings = Settings | null;
