// Server-only: gather the current user's data into a compact JSON snapshot for the
// Ask assistant, deciding whether to send the full data (let the model pick what it
// needs) or a trimmed recent slice (to save tokens) based on size.
import "server-only";
import { listTasks } from "@/lib/db/tasks";
import { listHabits } from "@/lib/db/habits";
import { listHabitEntries } from "@/lib/db/habitEntries";
import { listGoals } from "@/lib/db/goals";
import { listProjects } from "@/lib/db/projects";
import { listNotes } from "@/lib/db/notes";
import { listTags } from "@/lib/db/tags";
import { listAgenda } from "@/lib/db/agenda";
import { getUser } from "@/lib/db/users";
import { getSettings } from "@/lib/db/settings";
import { iso, addDays } from "@/lib/date";
import { buildAggregates } from "@/lib/ai/aggregates";
import { pickTimezone, readTimezoneCookie } from "@/lib/timezone-server";

// ~chars; roughly THRESHOLD/4 tokens. Above this we trim to the recent slice.
const FULL_THRESHOLD = 20000;
const ENTRY_DAYS = 60; // habit entries to keep when trimming
const DONE_DAYS = 30; // completed tasks to keep when trimming

export type SnapshotData = {
  today: string;
  user: { name: string | null };
  settings: {
    weekStart: string;
    birthDate: string | null;
    lifeSpanYears: number | null;
  };
  tags: { id: string; name: string }[];
  goals: {
    id: string;
    title: string;
    category: string;
    lifeArea: import("@/lib/types").EntityLifeArea;
    progress: number;
    targetDate: string | null;
  }[];
  projects: {
    id: string;
    title: string;
    lifeArea: import("@/lib/types").EntityLifeArea;
    goalId: string | null;
    progress: number;
    label: string;
  }[];
  habits: {
    id: string;
    name: string;
    frequency: string;
    lifeArea: import("@/lib/types").EntityLifeArea;
    goalIds: string[];
    archived: boolean;
  }[];
  habitEntries: { habit: string; date: string }[];
  tasks: {
    id: string;
    title: string;
    status: string;
    priority: string;
    due: string | null;
    lifeArea: import("@/lib/types").EntityLifeArea;
    projectId: string | null;
    goalId: string | null;
    tags: string[];
    createdAt: string;
    completedAt: string | null;
  }[];
  notes: {
    id: string;
    title: string;
    lifeArea: import("@/lib/types").EntityLifeArea;
    pinned: boolean;
    tags: string[];
    createdAt: string;
  }[];
  // The id and date are what make a meeting EDITABLE by the assistant: an
  // update op needs the real id, and without the date the model cannot tell
  // "the standup" on Monday from the one next week.
  agenda: {
    id: string;
    time: string;
    title: string;
    date: string | null;
    durationMins: number;
    repeats: boolean;
  }[];
};

export type SnapshotResult = {
  json: string;
  dataMode: "full" | "trimmed";
  data: SnapshotData;
};

export async function buildUserSnapshot(
  userId: string,
): Promise<SnapshotResult> {
  // Every list*() below is scoped to `userId` (the authenticated caller, passed
  // down from askAssistant → requireUserId). The Ask assistant therefore only
  // ever sees the requesting user's own data — never another account's.
  const [
    tasks,
    habits,
    entries,
    goals,
    projects,
    notes,
    tags,
    agenda,
    user,
    settings,
  ] = await Promise.all([
    listTasks(userId),
    listHabits(userId),
    listHabitEntries(userId),
    listGoals(userId),
    listProjects(userId),
    listNotes(userId),
    listTags(userId),
    listAgenda(userId),
    getUser(userId),
    getSettings(userId),
  ]);

  const fromCookie = await readTimezoneCookie();
  const timezone = pickTimezone(settings, fromCookie);
  const today = iso(new Date(), timezone);
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const habitName = new Map(habits.map((h) => [h.id, h.name]));

  const aggregates = buildAggregates({
    tasks,
    habits,
    entries,
    projects,
    goals,
    tags,
    today,
    timezone,
  });

  const build = (full: boolean) => {
    const sinceEntry = iso(
      addDays(-ENTRY_DAYS, new Date(), timezone),
      timezone,
    );
    const sinceDone = iso(addDays(-DONE_DAYS, new Date(), timezone), timezone);
    const keptEntries = full
      ? entries
      : entries.filter((e) => e.date >= sinceEntry);
    const keptTasks = full
      ? tasks
      : tasks.filter(
          (t) => t.status !== "done" || (t.completedAt ?? "") >= sinceDone,
        );
    return {
      today,
      timezone,
      // Precomputed by our code — the model must use these for any statistic
      // rather than re-counting the raw rows below.
      aggregates,
      user: { name: user?.name ?? null },
      settings: {
        weekStart: settings?.weekStart ?? "mon",
        birthDate: settings?.birthDate ?? null,
        lifeSpanYears: settings?.lifeSpanYears ?? null,
        timezone: settings?.timezone ?? timezone,
      },
      tags: tags.map((t) => ({ id: t.id, name: t.name })),
      goals: goals.map((g) => ({
        id: g.id,
        title: g.title,
        category: g.category,
        lifeArea: g.lifeArea,
        progress: g.progress,
        targetDate: g.targetDate,
      })),
      projects: projects.map((p) => ({
        id: p.id,
        title: p.title,
        lifeArea: p.lifeArea,
        goalId: p.goalId,
        progress: p.progress,
        label: p.label,
      })),
      habits: habits.map((h) => ({
        id: h.id,
        name: h.name,
        frequency: h.frequency.type,
        lifeArea: h.lifeArea,
        goalIds: h.goalIds,
        archived: h.archived,
      })),
      habitEntries: keptEntries.map((e) => ({
        habit: habitName.get(e.habitId) ?? e.habitId,
        date: e.date,
      })),
      tasks: keptTasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        due: t.due,
        lifeArea: t.lifeArea,
        projectId: t.projectId,
        goalId: t.goalId,
        tags: t.tagIds.map((id) => tagName.get(id) ?? id),
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      })),
      notes: notes.map((n) => ({
        id: n.id,
        title: n.title,
        lifeArea: n.lifeArea,
        pinned: n.pinned,
        tags: n.tagIds.map((id) => tagName.get(id) ?? id),
        createdAt: n.createdAt,
      })),
      agenda: agenda.map((a) => ({
        id: a.id,
        time: a.time,
        title: a.title,
        date: a.date,
        durationMins: a.durationMins,
        repeats: a.recurrence != null,
      })),
    };
  };

  const fullData = build(true);
  const fullJson = JSON.stringify(fullData);
  if (fullJson.length <= FULL_THRESHOLD) {
    return { json: fullJson, dataMode: "full", data: fullData };
  }
  const trimmedData = build(false);
  return {
    json: JSON.stringify(trimmedData),
    dataMode: "trimmed",
    data: trimmedData,
  };
}
