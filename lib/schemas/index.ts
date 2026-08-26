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
  /**
   * Show a meeting's ID and passcode under it.
   *
   * Off by default: the join button already carries both, so for most people
   * they are two chips of noise under every call. They earn their place only
   * when you dial in by phone, or read the code to somebody else.
   */
  showMeetingCodes: z.boolean().default(false),
  /**
   * Has the one-time "you can mirror your real calendar in here" offer been
   * shown?
   *
   * Server-side rather than localStorage because "only the first time" means
   * the first time for the PERSON, not the first time per browser. Somebody
   * who dismissed it on a laptop should not meet it again on their phone.
   */
  calendarLinkOffered: z.boolean().default(false),
  /** Has the one-time "add PUMMA to your home screen" nudge been shown? */
  installOffered: z.boolean().default(false),
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
  /**
   * Where each surface starts when the URL does not say otherwise. URL params
   * always win (Home's "Today's tasks" navigates with ?tab=today), so these
   * only fill silence. Defaults are exactly what each surface hardcoded
   * before the setting existed: an untouched account changes nothing.
   */
  defaultTasksTab: z.enum(["today", "upcoming", "all"]).default("all"),
  defaultTasksGroup: z.enum(["none", "tag", "project"]).default("none"),
  defaultTasksStatus: z
    .array(z.enum(["todo", "doing", "done"]))
    .default([]),
  defaultTasksPriority: z
    .array(z.enum(["low", "med", "high"]))
    .default([]),
  defaultHabitFrequency: z
    .enum(["daily", "weekly", "monthly"])
    .default("daily"),
  /**
   * Whether the projects rail rests on its sort control rather than on the
   * first project. Off by default: the control costs a quarter of the rail
   * on a phone, and most visits are about the projects. Scrolling the rail
   * left reveals it and sets this; scrolling right or picking a project
   * clears it.
   */
  projectsRailSortVisible: z.boolean().default(false),
  /**
   * The nudge: per setting key, the last few values chosen at creation time,
   * and when the one-time "make it the default?" offer was answered. History
   * for a key stops being recorded once the key is answered, so this is
   * self-limiting by construction — see lib/nudge.ts for the rules.
   */
  nudgeHistory: z.record(z.string(), z.array(z.string())).default({}),
  nudgeAnswered: z.record(z.string(), z.string()).default({}),
  taskSort: z.enum(["priority", "due", "created", "alpha"]).default("priority"),
  projectTaskSort: z
    .enum(["priority", "custom", "created", "alpha"])
    .default("priority"),
  projectSort: z.enum(["created", "alpha", "progress"]).default("created"),
  noteSort: z.enum(["edited", "created", "alpha"]).default("edited"),
  tagSort: z.enum(["custom", "alpha", "usage", "created"]).default("custom"),
  /** Reminders: what fires, and how long before. See lib/notifications. */
  notifications: z
    .object({
      meetingsEnabled: z.boolean().default(true),
      meetingLeadMins: z.array(z.number().int().min(0).max(1440)).default([10]),
      tasksEnabled: z.boolean().default(true),
      taskLeadMins: z.number().int().min(0).max(1440).default(0),
      digestEnabled: z.boolean().default(false),
      digestTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .default("09:00"),
    })
    .default({}),
  /** Which sortable lists are currently running backwards. */
  sortReversed: z
    .array(z.enum(["task", "projectTask", "project", "note", "tag"]))
    .default([]),
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

/**
 * A calendar somebody else owns, that PUMMA reads.
 *
 * Read only, on purpose. The whole point of the subscription model is that it
 * needs no OAuth, no app review and nobody's administrator: every calendar
 * product can publish a secret .ics URL, and fetching one is a plain GET.
 *
 * `url` is a CREDENTIAL. Anyone holding it can read the calendar, forever,
 * without signing in to anything. It is encrypted at rest like authored
 * content and must never be logged or returned to the client in full.
 */
/**
 * One notification, scheduled or already sent.
 *
 * Rows are MATERIALIZED ahead of time rather than worked out at delivery: the
 * question "what should fire in the next minute" then costs one indexed query
 * instead of expanding every recurrence rule the user owns, and a row that
 * exists can be inspected, snoozed and read back in a tray.
 *
 * The id is derived, not random — see notificationId(). That is what makes
 * re-materializing safe: the same meeting at the same lead time produces the
 * same id, so the writer upserts instead of accumulating a duplicate every
 * five minutes.
 */
export const notificationSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  kind: z.enum(["meeting", "task", "digest"]),
  /** What it is about. `date` disambiguates one occurrence of a repeat. */
  entityId: z.string().default(""),
  entityDate: z.string().default(""),
  /** Minutes before the event this row represents. 0 = at the moment. */
  leadMins: z.number().int().default(0),
  /** When it should fire, ISO UTC. The only field the delivery loop sorts on. */
  fireAt: z.string(),
  status: z
    .enum(["scheduled", "sent", "read", "dismissed"])
    .default("scheduled"),
  title: z.string().max(200).default(""),
  body: z.string().max(400).default(""),
  /** Where clicking it should land in the app. */
  url: z.string().max(300).default("/"),
  /** A call to join, when the invite carried one. */
  joinUrl: z.string().max(2048).default(""),
  sentAt: z.string().nullable().default(null),
  readAt: z.string().nullable().default(null),
  createdAt: z.string(),
});

/**
 * One browser, on one device, that agreed to receive push.
 *
 * The endpoint is a capability: anyone holding it can push a notification to
 * that browser until it is revoked, so it is encrypted at rest with the keys
 * beside it, exactly like a calendar feed URL.
 */
export const pushSubscriptionSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  endpoint: z.string().max(2048),
  p256dh: z.string().max(300),
  auth: z.string().max(300),
  /** "Chrome on macOS" — so a device list is readable when revoking one. */
  label: z.string().max(80).default("This device"),
  createdAt: z.string(),
  lastSeenAt: z.string(),
});

export const calendarFeedSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  /** The user's name for it, or the feed's own X-WR-CALNAME. */
  label: z.string().max(80).default("Calendar"),
  url: z.string().max(2048),
  /** Which side of life its events belong to. */
  lifeArea: z.enum(["personal", "work"]).default("personal"),
  /** Dot colour in the agenda, so two feeds are told apart at a glance. */
  color: z.string().max(40).default("var(--calendar)"),
  enabled: z.boolean().default(true),
  /** ISO. null until the first successful fetch. */
  lastSyncedAt: z.string().nullable().default(null),
  /** Empty when the last fetch was fine; otherwise what to show the user. */
  lastError: z.string().max(300).default(""),
  /** Conditional-GET validators, so a poll that changes nothing is cheap. */
  etag: z.string().max(200).default(""),
  lastModified: z.string().max(200).default(""),
  createdAt: z.string(),
});

/**
 * One occurrence of an external event, already expanded and localised.
 *
 * Occurrences are stored rather than rules. It costs rows, and it buys the
 * thing that matters: reading a day is a query on a date, identical to how
 * everything else in the app reads a day, with no expander in the hot path.
 * They are disposable, and a resync rebuilds them.
 */
export const externalEventSchema = z.object({
  _id: z.string(),
  userId: z.string(),
  feedId: z.string(),
  /** Unique per occurrence (VEVENT UID plus its start). */
  key: z.string(),
  title: z.string(),
  /** YYYY-MM-DD in the user's zone at sync time. */
  date: z.string(),
  /** HH:MM, or null for an all-day event. */
  time: z.string().nullable().default(null),
  durationMins: z.number().int().min(1).max(10080).default(30),
  allDay: z.boolean().default(false),
  location: z.string().max(500).default(""),
  notes: z.string().max(2000).default(""),
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

export type NotificationDoc = z.infer<typeof notificationSchema>;
export type AppNotification = Omit<NotificationDoc, "_id"> & { id: string };
export type PushSubscriptionDoc = z.infer<typeof pushSubscriptionSchema>;
export type PushSubscriptionRow = Omit<PushSubscriptionDoc, "_id"> & {
  id: string;
};

export type CalendarFeedDoc = z.infer<typeof calendarFeedSchema>;
export type ExternalEventDoc = z.infer<typeof externalEventSchema>;
export type CalendarFeed = Omit<CalendarFeedDoc, "_id"> & { id: string };
export type ExternalEvent = Omit<ExternalEventDoc, "_id"> & { id: string };

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
