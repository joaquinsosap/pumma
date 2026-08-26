// First-login provisioning: every new account gets its own app-user doc,
// settings, life tags, and a thin set of examples — NOT the demo seed.
import "server-only";
import { insertUser } from "@/lib/db/users";
import { insertSettings, updateSettings } from "@/lib/db/settings";
import { ensureLifeTags, listTags } from "@/lib/db/tags";
import { insertTask } from "@/lib/db/tasks";
import { insertNote } from "@/lib/db/notes";
import { insertHabit } from "@/lib/db/habits";
import { insertGoal } from "@/lib/db/goals";
import { insertProject } from "@/lib/db/projects";
import { buildStarterContent } from "@/lib/starter-content";
import { starterHash, type StarterEntry } from "@/lib/starter";
import { createSeedData } from "@/lib/seed";
import { LIFE_SPAN_DEFAULT } from "@/lib/life-constants";
import { iso } from "@/lib/date";

/**
 * Load the big demo dataset instead of the thin starter set.
 *
 * A local switch, off everywhere else, so that a self-hosted install opens on
 * exactly what the hosted one does. Its reason to exist is development: a
 * heat grid with one day in it and a board with three cards tell you nothing
 * about how either behaves once they are full.
 */
function wantsSampleData(): boolean {
  const raw = (process.env.SAMPLE_DATA ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export async function bootstrapNewUser(user: {
  id: string;
  name?: string | null;
  email?: string | null;
}): Promise<void> {
  const today = iso();
  await insertUser({
    _id: user.id,
    name: user.name?.trim() || "there",
    email: user.email ?? undefined,
    createdAt: today,
  });
  await insertSettings({
    userId: user.id,
    theme: "light",
    defaultCaptureType: "task",
    defaultDueToday: true,
    defaultTasksTab: "all" as const,
    defaultTasksGroup: "none" as const,
    defaultTasksStatus: [],
    defaultTasksPriority: [],
    defaultHabitFrequency: "daily" as const,
    projectsRailSortVisible: false,
    nudgeHistory: {},
    nudgeAnswered: {},

    weekStart: "mon",
    birthDate: null,
    lifeSpanYears: LIFE_SPAN_DEFAULT,
    lifeCalendarFullView: false,
    showMeetingCodes: false,
    calendarLinkOffered: false,
    sortReversed: [],
    habitVisibleDays: 30,
    habitVisibleWeeks: 8,
    habitVisibleMonths: 3,
    timezone: "UTC", // refined by the client TimezoneSync cookie on first load
    aiApiKeyEnc: null,
    aiApiKeyLast4: null,
    aiProvider: "anthropic",
    aiModel: null,
    lifeAutoSwitch: false,
    workStart: "09:00",
    workEnd: "18:00",
    workDays: [1, 2, 3, 4, 5],
    lifeAutoOverrideMins: 60,
    spaceShortcuts: true,
    tagAutoClean: false,
    tagAutoCleanDays: 30,
    tagsCleanedAt: null,
    // Null: a brand-new account is exactly who the tour is for.
    dateOrder: "dmy" as const,
    tutorialSeenAt: null,
    // Filled in below, once there is something to record.
    starterManifest: null,
    taskSort: "priority",
    projectTaskSort: "priority",
    projectSort: "created",
    noteSort: "edited",
    tagSort: "custom",
  });
  await ensureLifeTags(user.id);

  const manifest = wantsSampleData()
    ? await plantSampleData(user.id)
    : await plantStarterContent(user.id);

  if (manifest.length) {
    await updateSettings(user.id, { starterManifest: manifest });
  }
}

/** The thin set: one real example per space. */
async function plantStarterContent(userId: string): Promise<StarterEntry[]> {
  const tags = await listTags(userId);
  const personal = tags.filter((t) => t.name === "personal").map((t) => t.id);
  const bundle = buildStarterContent(userId, personal);

  for (const doc of bundle.projects) await insertProject(doc);
  for (const doc of bundle.goals) await insertGoal(doc);
  for (const doc of bundle.habits) await insertHabit(doc);
  for (const doc of bundle.tasks) await insertTask(doc);
  for (const doc of bundle.notes) await insertNote(doc);

  return bundle.manifest;
}

/**
 * The demo dataset, for a local install with SAMPLE_DATA on.
 *
 * Reuses the seed the demo accounts get, minus its user and settings rows —
 * this account already has its own. Recorded in the manifest too, so the same
 * one-click clear empties it when you are done poking at it.
 */
async function plantSampleData(userId: string): Promise<StarterEntry[]> {
  const seed = createSeedData(userId);
  const manifest: StarterEntry[] = [];
  const record = (kind: StarterEntry["kind"], doc: { _id: string }) => {
    manifest.push({
      kind,
      id: doc._id,
      hash: starterHash(kind, doc as unknown as Record<string, unknown>),
    });
  };

  for (const doc of seed.projects) {
    await insertProject(doc);
    record("project", doc);
  }
  for (const doc of seed.goals) {
    await insertGoal(doc);
    record("goal", doc);
  }
  for (const doc of seed.habits) {
    await insertHabit(doc);
    record("habit", doc);
  }
  for (const doc of seed.tasks) {
    await insertTask(doc);
    record("task", doc);
  }
  for (const doc of seed.notes) {
    await insertNote(doc);
    record("note", doc);
  }
  return manifest;
}
