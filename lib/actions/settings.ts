"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult, Theme, OmniType } from "@/lib/types";
import type { Tag } from "@/lib/schemas";
import { getSettings, updateSettings } from "@/lib/db/settings";
import { insertTag } from "@/lib/db/tags";
import { updateUser } from "@/lib/db/users";
import { requireUserId } from "@/lib/auth/session";
import {
  DEFAULT_PROVIDER,
  isPlausibleKey,
  isProviderId,
  providerDef,
} from "@/lib/ai/providers";
import { persistTimezoneCookie } from "@/lib/timezone-server";
import { isValidTimezone, normalizeTimezone } from "@/lib/timezone";
import { isoDate, tagName } from "@/lib/validation";
import {
  markAnswered,
  nudgeVerdict,
  recordChoice,
  type NudgeKey,
  type NudgeVerdict,
} from "@/lib/nudge";
import { LIFE_SPAN_MAX } from "@/lib/life-constants";

const themeSchema = z.enum(["light", "dark"]);

export async function setTheme(theme: Theme): Promise<ActionResult> {
  const parsed = themeSchema.safeParse(theme);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  await updateSettings(userId, { theme: parsed.data });
  revalidatePath("/", "layout");
  return { ok: true };
}

// .strict() so unexpected keys (e.g. crafted `$`-prefixed fields) are rejected
// before they can reach the data layer's $set.
const settingsPatchSchema = z
  .object({
    defaultCaptureType: z.enum(["task", "habit", "goal", "note"]).optional(),
    defaultDueToday: z.boolean().optional(),
    weekStart: z.enum(["mon", "sun"]).optional(),
    birthDate: isoDate.nullable().optional(),
    lifeSpanYears: z.number().int().min(1).max(LIFE_SPAN_MAX).optional(),
    lifeCalendarFullView: z.boolean().optional(),
    showMeetingCodes: z.boolean().optional(),
    calendarLinkOffered: z.boolean().optional(),
    installOffered: z.boolean().optional(),
    habitVisibleDays: z.number().int().min(1).max(365).optional(),
    habitVisibleWeeks: z.number().int().min(1).max(52).optional(),
    habitVisibleMonths: z.number().int().min(1).max(24).optional(),
    timezone: z.string().max(64).optional(),
    lifeAutoSwitch: z.boolean().optional(),
    workStart: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    workEnd: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    workDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    lifeAutoOverrideMins: z.number().int().min(5).max(720).optional(),
    spaceShortcuts: z.boolean().optional(),
    // Where each surface starts when the URL is silent; the URL always wins.
    defaultTasksTab: z.enum(["today", "upcoming", "all"]).optional(),
    defaultTasksGroup: z.enum(["none", "tag", "project"]).optional(),
    defaultTasksStatus: z
      .array(z.enum(["todo", "doing", "done"]))
      .max(3)
      .optional(),
    defaultTasksPriority: z
      .array(z.enum(["low", "med", "high"]))
      .max(3)
      .optional(),
    defaultHabitFrequency: z.enum(["daily", "weekly", "monthly"]).optional(),
    projectsRailSortVisible: z.boolean().optional(),
    taskSort: z.enum(["priority", "due", "created", "alpha"]).optional(),
    sortReversed: z
      .array(z.enum(["task", "projectTask", "project", "note", "tag"]))
      .max(5)
      .optional(),
    notifications: z
      .object({
        meetingsEnabled: z.boolean(),
        meetingLeadMins: z.array(z.number().int().min(0).max(1440)).max(6),
        tasksEnabled: z.boolean(),
        taskLeadMins: z.number().int().min(0).max(1440),
        digestEnabled: z.boolean(),
        digestTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .strict()
      .optional(),
    projectTaskSort: z
      .enum(["priority", "custom", "created", "alpha"])
      .optional(),
    projectSort: z.enum(["created", "alpha", "progress"]).optional(),
    noteSort: z.enum(["edited", "created", "alpha"]).optional(),
    tagSort: z.enum(["custom", "alpha", "usage", "created"]).optional(),
    tagAutoClean: z.boolean().optional(),
    tagAutoCleanDays: z.number().int().min(1).max(365).optional(),
    dateOrder: z.enum(["dmy", "mdy"]).optional(),
  })
  .strict();

export async function updateSettingsAction(patch: {
  defaultCaptureType?: OmniType;
  defaultDueToday?: boolean;
  weekStart?: "mon" | "sun";
  birthDate?: string | null;
  lifeSpanYears?: number;
  lifeCalendarFullView?: boolean;
  showMeetingCodes?: boolean;
  calendarLinkOffered?: boolean;
  installOffered?: boolean;
  habitVisibleDays?: number;
  habitVisibleWeeks?: number;
  habitVisibleMonths?: number;
  timezone?: string;
  lifeAutoSwitch?: boolean;
  workStart?: string;
  workEnd?: string;
  workDays?: number[];
  lifeAutoOverrideMins?: number;
  spaceShortcuts?: boolean;
  defaultTasksTab?: "today" | "upcoming" | "all";
  defaultTasksGroup?: "none" | "tag" | "project";
  defaultTasksStatus?: ("todo" | "doing" | "done")[];
  defaultTasksPriority?: ("low" | "med" | "high")[];
  defaultHabitFrequency?: "daily" | "weekly" | "monthly";
  projectsRailSortVisible?: boolean;
  taskSort?: "priority" | "due" | "created" | "alpha";
  sortReversed?: ("task" | "projectTask" | "project" | "note" | "tag")[];
  notifications?: {
    meetingsEnabled: boolean;
    meetingLeadMins: number[];
    tasksEnabled: boolean;
    taskLeadMins: number;
    digestEnabled: boolean;
    digestTime: string;
  };
  projectTaskSort?: "priority" | "custom" | "created" | "alpha";
  projectSort?: "created" | "alpha" | "progress";
  noteSort?: "edited" | "created" | "alpha";
  tagSort?: "custom" | "alpha" | "usage" | "created";
  tagAutoClean?: boolean;
  tagAutoCleanDays?: number;
  dateOrder?: "dmy" | "mdy";
}): Promise<ActionResult> {
  const parsed = settingsPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const data = parsed.data;

  const userId = await requireUserId();
  if (data.timezone !== undefined) {
    if (!isValidTimezone(data.timezone)) {
      return { ok: false, error: "Invalid timezone." };
    }
    data.timezone = normalizeTimezone(data.timezone);
    await persistTimezoneCookie(data.timezone);
  }
  await updateSettings(userId, data);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Remember that the tour has played.
 *
 * Its own action rather than a field on updateSettingsAction: that one is the
 * settings form's patch, validated against a schema of things a user chose,
 * and this is a timestamp the app writes for itself.
 */
export async function markTutorialSeen(): Promise<ActionResult> {
  const userId = await requireUserId();
  await updateSettings(userId, { tutorialSeenAt: new Date().toISOString() });
  // Deliberately no revalidatePath. This is written the moment the tour
  // starts, and revalidating the layout re-renders the gate that decides
  // whether the overlay exists — which tore the tour down on its own first
  // frame. Nothing on screen depends on this flag until the next page load,
  // and the overlay hides itself when it's finished.
  return { ok: true };
}

/** Play it again from Settings — clears the marker so the overlay re-arms. */
export async function replayTutorial(): Promise<ActionResult> {
  const userId = await requireUserId();
  await updateSettings(userId, { tutorialSeenAt: null });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function addTagAction(name: string): Promise<ActionResult<Tag>> {
  const parsed = tagName.safeParse(name.toLowerCase());
  if (!parsed.success) return { ok: false, error: "Invalid name" };
  const userId = await requireUserId();
  const tag = await insertTag(userId, parsed.data);
  if (!tag) return { ok: false, error: "Tag already exists" };
  revalidatePath("/", "layout");
  return { ok: true, data: tag };
}

/** Store the user's own provider key, encrypted. We keep only the last 4 chars
 *  in plaintext so the UI can show which key is set. The shape check is per
 *  provider and deliberately loose — it catches a pasted paragraph, not a
 *  revoked key; only a real call can tell you that. */
export async function setAiApiKeyAction(rawKey: string): Promise<ActionResult> {
  const key = String(rawKey ?? "").trim();
  if (key.length > 400)
    return { ok: false, error: "That key is implausibly long" };

  const userId = await requireUserId();
  const settings = await getSettings(userId);
  const provider = isProviderId(settings?.aiProvider)
    ? settings.aiProvider
    : DEFAULT_PROVIDER;
  const def = providerDef(provider);

  if (!isPlausibleKey(provider, key)) {
    return {
      ok: false,
      error: `That doesn't look like a ${def.label} key (${def.keyHint}).`,
    };
  }

  const { encryptSecret } = await import("@/lib/crypto");
  await updateSettings(userId, {
    aiApiKeyEnc: key ? encryptSecret(key) : null,
    aiApiKeyLast4: key ? key.slice(-4) : null,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Switch provider. The stored key goes with it — a key never works across
 *  providers, and leaving it would fail on the next call with a confusing
 *  message instead of an obvious empty field. */
export async function setAiProviderAction(
  provider: string,
): Promise<ActionResult> {
  if (!isProviderId(provider)) return { ok: false, error: "Unknown provider" };
  const userId = await requireUserId();
  await updateSettings(userId, {
    aiProvider: provider,
    aiModel: null,
    aiApiKeyEnc: null,
    aiApiKeyLast4: null,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

const modelSchema = z
  .string()
  .trim()
  .max(120)
  // Model ids are vendor-namespaced slugs; anything else is a paste accident.
  .regex(/^[A-Za-z0-9._:\/-]*$/, "That doesn't look like a model name");

/** Empty means "use the provider's default", which is why null is stored. */
export async function setAiModelAction(model: string): Promise<ActionResult> {
  const parsed = modelSchema.safeParse(model);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid model",
    };
  }
  const userId = await requireUserId();
  await updateSettings(userId, { aiModel: parsed.data || null });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Remove the stored key — Plan/Ask stop working until a new key is added.
 *  Hosted (mongodb) accounts have no server-key fallback by design; only
 *  memory-mode local dev falls back to the shared env key. */
export async function clearAiApiKeyAction(): Promise<ActionResult> {
  const userId = await requireUserId();
  await updateSettings(userId, { aiApiKeyEnc: null, aiApiKeyLast4: null });
  revalidatePath("/", "layout");
  return { ok: true };
}

const userNameSchema = z.string().trim().min(1).max(64);

export async function updateUserNameAction(
  name: string,
): Promise<ActionResult> {
  const parsed = userNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: "Invalid name" };

  const userId = await requireUserId();
  const updated = await updateUser(userId, { name: parsed.data });
  if (!updated) return { ok: false, error: "User not found" };

  revalidatePath("/", "layout");
  return { ok: true };
}

// ── The nudge ─────────────────────────────────────────────────────────────
// Pure rules live in lib/nudge.ts; these two actions are the only writers of
// nudgeHistory / nudgeAnswered. Values are validated per key so the history
// can never hold anything but the enums the Settings UI could set anyway.

const NUDGE_VALUES: Record<NudgeKey, readonly string[]> = {
  captureType: ["task", "habit", "goal", "note"],
  captureDue: ["none", "today", "tomorrow"],
  habitFrequency: ["daily", "weekly", "monthly"],
};

const nudgeKeySchema = z.enum(["captureType", "captureDue", "habitFrequency"]);

/** The current default for a key, in the value space the history records. */
function currentDefaultFor(
  key: NudgeKey,
  settings: {
    defaultCaptureType: string;
    defaultDueToday: boolean;
    defaultHabitFrequency: string;
  },
): string {
  switch (key) {
    case "captureType":
      return settings.defaultCaptureType;
    case "captureDue":
      // Still bool-shaped in settings; "tomorrow" can be chosen but never be
      // the default yet, which makes it eligible for a suggestion (correct,
      // if premature, until the tri-state lands). See DEFAULTS-PLAN.local.md.
      return settings.defaultDueToday ? "today" : "none";
    case "habitFrequency":
      return settings.defaultHabitFrequency;
  }
}

/**
 * Record one creation-time choice, and say whether to offer a new default.
 *
 * Called after a successful creation, never before it: the nudge must not
 * stand between the user and their save. A non-null result means the UI may
 * show the one-time popover; showing it must be followed by answerNudgeAction
 * or the offer will (correctly) come back next time.
 */
export async function recordNudgeChoiceAction(
  key: NudgeKey,
  value: string,
): Promise<ActionResult<{ suggest: NudgeVerdict | null }>> {
  const parsedKey = nudgeKeySchema.safeParse(key);
  if (!parsedKey.success) return { ok: false, error: "Invalid input" };
  if (!NUDGE_VALUES[parsedKey.data].includes(value))
    return { ok: false, error: "Invalid input" };

  const userId = await requireUserId();
  const settings = await getSettings(userId);
  if (!settings) return { ok: false, error: "No settings" };

  const history = recordChoice(
    settings.nudgeHistory,
    settings.nudgeAnswered,
    parsedKey.data,
    value,
  );
  if (history !== settings.nudgeHistory)
    await updateSettings(userId, { nudgeHistory: history });

  const suggest = nudgeVerdict(
    history,
    settings.nudgeAnswered,
    parsedKey.data,
    currentDefaultFor(parsedKey.data, settings),
  );
  return { ok: true, data: { suggest } };
}

/**
 * Spend the one-time offer. Accepting also applies the new default; either
 * way the key never asks again and its trail is dropped.
 */
export async function answerNudgeAction(
  key: NudgeKey,
  accept: boolean,
  value: string,
): Promise<ActionResult> {
  const parsedKey = nudgeKeySchema.safeParse(key);
  if (!parsedKey.success) return { ok: false, error: "Invalid input" };
  if (!NUDGE_VALUES[parsedKey.data].includes(value))
    return { ok: false, error: "Invalid input" };

  const userId = await requireUserId();
  const settings = await getSettings(userId);
  if (!settings) return { ok: false, error: "No settings" };

  const { history, answered } = markAnswered(
    settings.nudgeHistory,
    settings.nudgeAnswered,
    parsedKey.data,
    new Date().toISOString(),
  );

  const patch: Parameters<typeof updateSettings>[1] = {
    nudgeHistory: history,
    nudgeAnswered: answered,
  };
  if (accept) {
    switch (parsedKey.data) {
      case "captureType":
        patch.defaultCaptureType = value as OmniType;
        break;
      case "captureDue":
        // Until the tri-state default exists, "tomorrow" accepts as today
        // being off, the closest the bool can express. Revisit with the
        // tri-state (DEFAULTS-PLAN.local.md, open item 4).
        patch.defaultDueToday = value === "today";
        break;
      case "habitFrequency":
        patch.defaultHabitFrequency = value as
          | "daily"
          | "weekly"
          | "monthly";
        break;
    }
  }
  await updateSettings(userId, patch);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Record the browser's timezone, once, if nothing has claimed the field.
 *
 * The cookie TimezoneSync writes is enough for every server READ, because
 * those all happen inside a request. Background work has no request and no
 * cookie: the notification planner runs on a timer, and planning in UTC for
 * somebody in Montevideo puts every reminder three hours out. So the zone is
 * also persisted here.
 *
 * Never overwrites a zone that differs from the default. Somebody who chose
 * their timezone deliberately — travelling, or working across one — must not
 * have that choice quietly reverted by the machine they happen to open next.
 */
export async function syncTimezoneAction(
  timeZone: string,
): Promise<ActionResult> {
  const parsed = z.string().max(64).safeParse(timeZone);
  if (!parsed.success || !isValidTimezone(parsed.data)) {
    return { ok: false, error: "Invalid timezone" };
  }
  const userId = await requireUserId();
  const settings = await getSettings(userId);
  const stored = settings?.timezone ?? "UTC";
  if (stored !== "UTC" && stored !== "") return { ok: true };
  const next = normalizeTimezone(parsed.data);
  if (next === stored) return { ok: true };
  await updateSettings(userId, { timezone: next });
  return { ok: true };
}
