/**
 * The nudge: notice that the user keeps overriding a default, and offer,
 * exactly once, to make their habit the default.
 *
 * Everything here is pure. The store is two maps that live in settings:
 * `history`, the last few values chosen at creation time per setting key,
 * and `answered`, an ISO date per key once the offer has been shown. The
 * caller records a choice after each successful creation and asks for a
 * verdict; rendering the popover and writing the answer back are UI work
 * and live elsewhere.
 *
 * The rules, straight from the spec's own arithmetic:
 *
 * - Streak: the last 3 recorded choices are the same value V, and V is not
 *   the current default. Fires as early as the third creation. This is the
 *   dominant clause.
 * - Window: at least 4 recorded, and at least 3 of the last 4 are V. The
 *   only shapes this adds beyond a streak are V-V-x-V and V-x-V-V.
 *
 * One offer per key, ever. Shown counts as spent whether accepted or
 * dismissed, and an answered key stops recording entirely, which keeps the
 * stored trail short-lived by construction: the history exists only until
 * it has done its one job. That is also the honest answer to "is this data
 * collection?": at most four values, derived from content the user already
 * created, stored in their own encrypted settings row, never aggregated,
 * never sent anywhere, gone from use the moment the question is answered.
 */

/** The last-N buffer per setting key. */
export type NudgeHistory = Record<string, string[]>;
/** Key -> ISO date the offer was shown (accepted or dismissed alike). */
export type NudgeAnswered = Record<string, string>;

/** Keys the engine knows. Adding one is adding a row here and a caller. */
export type NudgeKey = "captureType" | "captureDue" | "habitFrequency";

/** How much trail a verdict looks at; nothing older is ever kept. */
export const WINDOW = 4;
/** How many identical choices in a row fire on their own. */
export const STREAK = 3;

/**
 * Record one choice. Returns a new history; never mutates.
 *
 * An answered key records nothing: not out of caution but because the data
 * has no further purpose, and the cheapest privacy policy is not holding
 * what you cannot use.
 */
export function recordChoice(
  history: NudgeHistory,
  answered: NudgeAnswered,
  key: NudgeKey,
  value: string,
): NudgeHistory {
  if (answered[key]) return history;
  const prev = history[key] ?? [];
  return { ...history, [key]: [...prev, value].slice(-WINDOW) };
}

export type NudgeVerdict = {
  key: NudgeKey;
  /** The value to offer as the new default. */
  value: string;
};

/**
 * Should we offer to change the default for this key right now?
 *
 * Null means no: not enough signal, or the signal points at the default
 * itself, or the question has already been asked.
 */
export function nudgeVerdict(
  history: NudgeHistory,
  answered: NudgeAnswered,
  key: NudgeKey,
  currentDefault: string,
): NudgeVerdict | null {
  if (answered[key]) return null;
  const trail = history[key] ?? [];

  // Streak: last 3 identical.
  if (trail.length >= STREAK) {
    const last = trail[trail.length - 1];
    const streak = trail
      .slice(-STREAK)
      .every((v) => v === last);
    if (streak && last !== currentDefault) return { key, value: last };
  }

  // Window: 3 of the last 4, once there are 4 to look at.
  if (trail.length >= WINDOW) {
    const window = trail.slice(-WINDOW);
    const counts = new Map<string, number>();
    for (const v of window) counts.set(v, (counts.get(v) ?? 0) + 1);
    for (const [value, n] of counts) {
      if (n >= STREAK && value !== currentDefault) return { key, value };
    }
  }

  return null;
}

/**
 * Mark a key as asked. Also drops its history: an answered key's trail has
 * no further use, so it does not get kept.
 */
export function markAnswered(
  history: NudgeHistory,
  answered: NudgeAnswered,
  key: NudgeKey,
  when: string,
): { history: NudgeHistory; answered: NudgeAnswered } {
  const rest = { ...history };
  delete rest[key];
  return { history: rest, answered: { ...answered, [key]: when } };
}

/**
 * Which quick-pick a chosen due date corresponds to, if any.
 *
 * Only the predefined picks are worth learning from. A date typed as
 * "#friday" or chosen from the calendar is a decision about one task, not a
 * standing preference, and recording it would teach the nudge to suggest a
 * default nobody can express in the picker anyway. Null means "do not
 * record", which is different from "none": none IS a pick.
 */
export function classifyDue(
  picked: string | null,
  todayIso: string,
  tomorrowIso: string,
): "none" | "today" | "tomorrow" | null {
  if (picked === null) return "none";
  const day = picked.slice(0, 10);
  if (day === todayIso) return "today";
  if (day === tomorrowIso) return "tomorrow";
  return null;
}

/** Human labels for the values the offer can name. */
export const NUDGE_LABELS: Record<string, string> = {
  task: "Task",
  habit: "Habit",
  goal: "Goal",
  note: "Note",
  none: "No date",
  today: "Today",
  tomorrow: "Tomorrow",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

/** What the offer is about, in the user's words. */
export const NUDGE_SUBJECT: Record<NudgeKey, string> = {
  captureType: "what capture creates",
  captureDue: "the due date for new tasks",
  habitFrequency: "how new habits repeat",
};
