import { z } from "zod";
import { LIFE_SPAN_DEFAULT } from "@/lib/life-constants";

export const userSchema = z.object({
  _id: z.string(),
  name: z.string(),
  email: z.string().optional(),
  createdAt: z.string(),
  // Demo accounts are ephemeral: provisioned by a hosted deployment, seeded
  // with sample data, and cleaned up after demoExpiresAt.
  isDemo: z.boolean().optional(),
  demoExpiresAt: z.string().optional(),
});

// One row per user, written by the hosted billing service; the app only READS
// it to answer "does this account have access?". Which payment provider fills
// it is a hosted-deployment concern — the app is provider-agnostic.
export const subscriptionSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  provider: z.string(),
  subscriptionId: z.string(),
  status: z.enum(["active", "trialing", "past_due", "paused", "canceled"]),
  priceId: z.string().nullable().default(null),
  renewsAt: z.string().nullable().default(null),
  canceledAt: z.string().nullable().default(null),
  // Provider license key tied to this subscription, when the hosted
  // billing service knows one.
  licenseKey: z.string().nullable().default(null),
  // Last time the hosted billing service cross-checked this row against
  // the provider — drives its revalidation staleness window.
  verifiedAt: z.string().nullable().default(null),
  updatedAt: z.string(),
});

export const settingsSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  theme: z.enum(["light", "dark"]),
  defaultCaptureType: z.enum(["task", "habit", "goal", "note"]),
  defaultDueToday: z.boolean(),
  weekStart: z.enum(["mon", "sun"]),
  birthDate: z.string().nullable().default(null),
  lifeSpanYears: z.number().default(LIFE_SPAN_DEFAULT),
  lifeCalendarFullView: z.boolean().default(false),
  habitVisibleDays: z.number().min(1).default(30),
  habitVisibleWeeks: z.number().min(1).default(8),
  habitVisibleMonths: z.number().min(1).default(3),
  timezone: z.string().default("UTC"),
  // The user's own Anthropic API key, AES-256-GCM encrypted at rest. Never
  // included in the client-facing DTO (see settingsToDto); `aiApiKeyLast4` is
  // the only piece the UI is allowed to see.
  aiApiKeyEnc: z.string().nullable().default(null),
  aiApiKeyLast4: z.string().nullable().default(null),
  // Which provider that key belongs to, and which model to ask for. Both
  // default, so a row written before providers existed reads as Anthropic on
  // its default model — exactly what it did before.
  aiProvider: z.string().default("anthropic"),
  aiModel: z.string().nullable().default(null),
  // Auto life-area switch: during work hours (on workDays) the Personal/Work
  // toggle follows the clock; a manual pick holds for lifeAutoOverrideMins.
  lifeAutoSwitch: z.boolean().default(false),
  workStart: z.string().default("09:00"),
  workEnd: z.string().default("18:00"),
  // JS getDay() numbers: 0=Sun … 6=Sat.
  workDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  lifeAutoOverrideMins: z.number().int().default(60),
  // Tag housekeeping. Off by default — deleting things silently should always
  // be opt-in. A tag counts as unused when nothing references it.
  /** Number keys jump between spaces. See `lib/space-shortcuts.ts`. */
  spaceShortcuts: z.boolean().default(true),
  tagAutoClean: z.boolean().default(false),
  tagAutoCleanDays: z.number().int().min(1).max(365).default(30),
  /** Throttle marker for the auto-sweep (runs at most once a day). */
  tagsCleanedAt: z.string().nullable().default(null),
  // When the 60-second tour was last finished. Null means it has never run,
  // which is the whole trigger — a nullable timestamp rather than a boolean so
  // "when did they see it" survives a later re-cut of the tour.
  // How "#7/8" is read. Day-first everywhere except the US, and guessing from
  // the browser locale would change what a saved capture meant when you
  // travel — so it's a setting with an honest default.
  dateOrder: z.enum(["dmy", "mdy"]).default("dmy"),
  tutorialSeenAt: z.string().nullable().default(null),
  /**
   * The examples this account was given on day one, and what each looked like
   * when it was planted — see `lib/starter.ts`. Kept here rather than as a
   * flag on every seeded document so that clearing them is one write and
   * touches no content schema. Null once cleared, which is also what hides
   * the button.
   */
  starterManifest: z
    .array(
      z.object({
        kind: z.enum(["task", "note", "habit", "goal", "project"]),
        id: z.string(),
        hash: z.string(),
      }),
    )
    .nullable()
    .default(null),
  /**
   * How each list is ordered, one field per view. Defaults are exactly what
   * each view did before the setting existed, so an untouched account changes
   * nothing. Values come from lib/collection-sort.ts, which is also where a
   * view learns which options it may offer.
   */
  taskSort: z.enum(["priority", "due", "created", "alpha"]).default("priority"),
  projectTaskSort: z
    .enum(["priority", "custom", "created", "alpha"])
    .default("priority"),
  projectSort: z.enum(["created", "alpha", "progress"]).default("created"),
  noteSort: z.enum(["edited", "created", "alpha"]).default("edited"),
  tagSort: z.enum(["custom", "alpha", "usage", "created"]).default("custom"),
});

export const tagSchema = z.object({
  _id: z.string(),
  // Backfilled by scripts/migrate-wave2.ts; default keeps pre-migration docs parseable.
  userId: z.string().default("seed-user-alex"),
  name: z.string(),
  color: z.string(),
  isDefault: z.boolean(),
  /**
   * The project this tag belongs to, if any. A tag belongs to at most one
   * project — that single field IS the "projects can't share tags" rule, so
   * there's nothing to keep in sync and no second object to drift.
   *
   * Tagging a task with one of these files the task under that project.
   */
  projectId: z.string().nullable().default(null),
  /**
   * The project's flagship tag, created with it and named after it. Can be
   * renamed, can't be deleted or detached — a project always keeps one.
   */
  isProjectPrimary: z.boolean().default(false),
  order: z.number(),
  createdAt: z.string(),
});

export const subtaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
});

export const taskSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  title: z.string(),
  description: z.string().default(""),
  subtasks: z.array(subtaskSchema).default([]),
  tagIds: z.array(z.string()),
  priority: z.enum(["low", "med", "high"]),
  status: z.enum(["todo", "doing", "done"]),
  due: z.string().nullable(),
  projectId: z.string().nullable(),
  goalId: z.string().nullable(),
  // Tasks/notes can live in both areas at once, driven by the special
  // "work"/"personal" tags — see lib/life-area-sync.ts.
  lifeArea: z.enum(["personal", "work", "both"]),
  order: z.number(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  timeSpentSec: z.number().default(0),
  timerStartedAt: z.string().nullable().default(null),
});

export const habitSchema = z.preprocess(
  (raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const doc = raw as Record<string, unknown>;
    const goalIds = Array.isArray(doc.goalIds)
      ? doc.goalIds
      : doc.goalId
        ? [doc.goalId]
        : [];
    const { goalId: _legacy, ...rest } = doc;
    return { ...rest, goalIds };
  },
  z.object({
    _id: z.string(),
    userId: z.string(),
    name: z.string(),
    color: z.string(),
    frequency: z.object({
      type: z.string(),
      target: z.number(),
      // Weekdays a daily habit applies on, 0 = Sunday. Optional: absent means
      // every day, which is what every habit written before this meant.
      days: z.array(z.number().int().min(0).max(6)).optional(),
    }),
    order: z.number(),
    archived: z.boolean(),
    goalIds: z.array(z.string()).default([]),
    goalTargetStreak: z.number().nullable().default(null),
    // Backfilled by scripts/migrate-entity-tags.ts. Default keeps pre-migration
    // docs parseable; the life tags inside are what decide lifeArea.
    tagIds: z.array(z.string()).default([]),
    lifeArea: z.enum(["personal", "work", "both"]),
    createdAt: z.string(),
  }),
);

export const habitEntrySchema = z.object({
  _id: z.string(),
  // Backfilled by scripts/migrate-wave2.ts; default keeps pre-migration docs parseable.
  userId: z.string().default("seed-user-alex"),
  habitId: z.string(),
  date: z.string(),
  done: z.boolean(),
});

export const noteSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  title: z.string(),
  body: z.string(),
  tagIds: z.array(z.string()),
  pinned: z.boolean(),
  // See taskSchema.lifeArea above — same "both" rule applies to notes.
  lifeArea: z.enum(["personal", "work", "both"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const goalSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  title: z.string(),
  // Goals stored "professional" before the wording was aligned with the rest
  // of the app. Reads coerce it, so a database that hasn't been migrated yet
  // still renders — `npm run db:goal-categories` rewrites the stored values.
  category: z.preprocess(
    (v) => (v === "professional" ? "work" : v),
    z.enum(["personal", "work"]),
  ),
  metricLabel: z.string(),
  progress: z.number().min(0).max(100),
  targetDate: z.string().nullable(),
  tagIds: z.array(z.string()).default([]),
  // Derived from the life tags — see lib/life-area-sync.ts. `category` above
  // is the column it sits in and mirrors this.
  lifeArea: z.enum(["personal", "work", "both"]),
  order: z.number().default(0),
  createdAt: z.string(),
});

export const projectSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  title: z.string(),
  description: z.string().default(""),
  color: z.string(),
  progress: z.number(),
  label: z.string(),
  goalId: z.string().nullable(),
  /** The project's own tags — not the tags that file tasks into it. */
  tagIds: z.array(z.string()).default([]),
  lifeArea: z.enum(["personal", "work", "both"]),
  createdAt: z.string(),
});

/**
 * Repeat rule for a meeting — a deliberately small subset of the iCalendar
 * (RFC 5545) RRULE model: enough for "every weekday", "every other Tuesday",
 * "monthly on the 12th", without dragging in a full RRULE parser.
 */
export const recurrenceSchema = z.object({
  freq: z.enum(["daily", "weekly", "monthly"]),
  /** Every N days/weeks/months. */
  interval: z.number().int().min(1).max(52).default(1),
  /** Weekly only: JS getDay() values (0=Sun … 6=Sat). Empty = the start day. */
  byWeekday: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  /** Inclusive YYYY-MM-DD end date, or null for "no end date". */
  until: z.string().nullable().default(null),
  /** Stop after N occurrences (counted from the start date), or null. */
  count: z.number().int().min(1).max(730).nullable().default(null),
});

export const agendaItemSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  time: z.string(),
  title: z.string(),
  sub: z.string(),
  color: z.string(),
  now: z.boolean().optional(),
  lifeArea: z.enum(["personal", "work"]),
  // YYYY-MM-DD. For a repeating meeting this is the series START date.
  // (null only survives on legacy "routine" rows — nothing creates them now.)
  date: z.string().nullable().default(null),
  // "routine" is legacy demo data; every meeting the app creates is "meeting".
  kind: z.enum(["routine", "meeting"]).default("routine"),
  /** Real field — the timeline used to regex this out of `sub`. */
  durationMins: z.number().int().min(5).max(600).default(30),
  /** Free-text location / agenda notes. */
  notes: z.string().max(1000).default(""),
  /** null = one-off. Otherwise the repeat rule anchored at `date`. */
  recurrence: recurrenceSchema.nullable().default(null),
  /** YYYY-MM-DD occurrences removed from a series ("delete just this one"). */
  exceptions: z.array(z.string()).default([]),
});

export const lifeMoodSchema = z.enum(["great", "good", "okay", "low", "rough"]);

export const lifeDaySchema = z.object({
  _id: z.string(),
  userId: z.string(),
  date: z.string(),
  note: z.string().default(""),
  mood: lifeMoodSchema.nullable().default(null),
  updatedAt: z.string(),
});

export const lifeWeekSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  weekStart: z.string(),
  note: z.string().default(""),
  mood: lifeMoodSchema.nullable().default(null),
  updatedAt: z.string(),
});

export type UserDoc = z.infer<typeof userSchema>;
export type SettingsDoc = z.infer<typeof settingsSchema>;
export type TagDoc = z.infer<typeof tagSchema>;
export type Subtask = z.infer<typeof subtaskSchema>;
export type TaskDoc = z.infer<typeof taskSchema>;
export type HabitDoc = z.infer<typeof habitSchema>;
export type HabitEntryDoc = z.infer<typeof habitEntrySchema>;
export type NoteDoc = z.infer<typeof noteSchema>;
export type GoalDoc = z.infer<typeof goalSchema>;
export type ProjectDoc = z.infer<typeof projectSchema>;
export type AgendaItemDoc = z.infer<typeof agendaItemSchema>;
export type Recurrence = z.infer<typeof recurrenceSchema>;
export type LifeDayDoc = z.infer<typeof lifeDaySchema>;
export type LifeWeekDoc = z.infer<typeof lifeWeekSchema>;
export type LifeMood = z.infer<typeof lifeMoodSchema>;
export type SubscriptionDoc = z.infer<typeof subscriptionSchema>;

export type User = Omit<UserDoc, "_id"> & { id: string };
// The encrypted key never crosses the server/client boundary — the DTO drops it.
export type Settings = Omit<SettingsDoc, "_id" | "aiApiKeyEnc"> & {
  id: string;
};
export type Tag = Omit<TagDoc, "_id"> & { id: string };
export type Task = Omit<TaskDoc, "_id"> & { id: string };
export type Habit = Omit<HabitDoc, "_id"> & { id: string };
export type HabitEntry = Omit<HabitEntryDoc, "_id"> & { id: string };
export type Note = Omit<NoteDoc, "_id"> & { id: string };
export type Goal = Omit<GoalDoc, "_id"> & { id: string };
export type Project = Omit<ProjectDoc, "_id"> & { id: string };
export type AgendaItem = Omit<AgendaItemDoc, "_id"> & { id: string };
export type LifeDay = Omit<LifeDayDoc, "_id"> & { id: string };
export type LifeWeek = Omit<LifeWeekDoc, "_id"> & { id: string };
export type Subscription = Omit<SubscriptionDoc, "_id"> & { id: string };

export function toDto<T extends { _id: string }>(
  doc: T,
): Omit<T, "_id"> & { id: string } {
  const { _id, ...rest } = doc;
  return { ...rest, id: _id } as Omit<T, "_id"> & { id: string };
}

/** Settings DTO with the encrypted API key stripped — safe to send to the client. */
export function settingsToDto(doc: SettingsDoc): Settings {
  const { _id, aiApiKeyEnc: _enc, ...rest } = doc;
  return { ...rest, id: _id };
}
