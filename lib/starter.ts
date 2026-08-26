import { createHash } from "crypto";

/**
 * The handful of things a new account starts with, and the rule for taking
 * them away again.
 *
 * A brand-new account used to open on nothing at all, which hides the whole
 * point of the app: a habit grid with no habits, a board with no cards and a
 * life calendar with no life read as an app that does nothing. So there is a
 * starter set — but a deliberately thin one. Enough that every space has one
 * real example of what belongs in it, and few enough that clearing it is not
 * a chore. Nine items, not ninety.
 *
 * The interesting part is removal. "Remove the starter items" must never take
 * something the person has made their own, and the only honest way to know
 * that is to record what each item looked like when we put it there and check
 * whether it still looks that way.
 *
 * WHY A FINGERPRINT RATHER THAN A MODIFIED DATE
 *
 * The obvious alternative is to compare created-at against updated-at. It does
 * not work here, for two separate reasons.
 *
 * The field mostly does not exist: only notes carry `updatedAt`; tasks, goals
 * and projects have `createdAt` alone, habits neither, and `oid()` is random
 * bytes rather than an ObjectId with a timestamp inside it. Adding one means
 * touching four schemas AND every write path that could ever modify them —
 * detail edits, status moves, board drags, bulk edits, the timer, the tag
 * menu, the assistant's changeset engine. Miss one and that item looks
 * untouched forever and gets deleted. A fingerprint asks nothing of any other
 * code: it is computed here, once when planting and once when clearing.
 *
 * And a modified date answers a different question. It moves when you tick the
 * sample task off or drag its card — the exact cases this is meant to still
 * clear away. Dates would leave that clutter behind and call it consent.
 *
 * What counts as making it yours is authored content: the words, the tags,
 * the dates and priorities you chose. What does not is *using* it — ticking
 * the sample task off, dragging the card to Doing, marking today's habit done.
 * Those are what the sample is for, and someone who tries the example and then
 * asks for the examples to go should not be told that one of them is now
 * theirs forever.
 */

/** A starter item, as recorded on the account that received it. */
export type StarterEntry = {
  /** Which collection it lives in. */
  kind: StarterKind;
  id: string;
  /** Fingerprint of the authored fields at the moment it was created. */
  hash: string;
};

export type StarterKind =
  | "task"
  | "note"
  | "habit"
  | "goal"
  | "project"
  | "agenda";

/**
 * The authored fields, per kind. Anything not listed here is either mechanical
 * (ids, timestamps, ordering) or is engagement rather than authorship
 * (`status`, `completedAt`, habit entries) — see the note above.
 */
const AUTHORED: Record<StarterKind, string[]> = {
  task: ["title", "description", "priority", "due", "tagIds", "subtasks"],
  note: ["title", "body", "tagIds"],
  habit: ["name", "frequency", "tagIds", "goalIds"],
  // `progress` is left out on purpose: on a goal it is computed from the
  // habits and projects underneath it, so it moves on its own.
  goal: ["title", "category", "targetDate", "tagIds"],
  project: ["title", "description", "tagIds"],
  // A meeting is authored the same way: somebody chose the words and the
  // moment. `recurrence` is left out because editing a repeat rule rewrites
  // the row's exceptions as a side effect, which is bookkeeping rather than
  // a change to the meeting itself.
  agenda: ["title", "time", "date", "durationMins"],
};

/**
 * A stable fingerprint of one item's authored fields.
 *
 * Arrays of ids are sorted before hashing: adding a tag and removing it again
 * leaves the item as it was found, and re-ordering tags is not authorship.
 * Subtasks keep their order, because moving a step of a recipe around IS a
 * change to the recipe, but only their titles and done-ness are ignored the
 * same way a task's own status is.
 */
export function starterHash(
  kind: StarterKind,
  doc: Record<string, unknown>,
): string {
  const parts: unknown[] = [kind];
  for (const field of AUTHORED[kind]) {
    parts.push(field, normalise(field, doc[field]));
  }
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 32);
}

function normalise(field: string, value: unknown): unknown {
  if (value == null) return null;
  if (field === "tagIds" || field === "goalIds") {
    return Array.isArray(value) ? [...value].map(String).sort() : value;
  }
  if (field === "subtasks") {
    // Titles only. Ticking a subtask off is using the item, not rewriting it.
    return Array.isArray(value)
      ? value.map((s) => (s as { title?: string })?.title ?? "")
      : value;
  }
  if (typeof value === "string") return value.trim();
  return value;
}

/**
 * Of the items we planted, which are still exactly as planted.
 *
 * Anything already deleted simply isn't in `current` and is skipped; anything
 * whose fingerprint no longer matches is kept and reported, so the UI can say
 * how many it is leaving behind rather than silently doing less than it said.
 */
export function partitionStarters(
  manifest: StarterEntry[],
  current: Map<string, Record<string, unknown>>,
): {
  removable: StarterEntry[];
  adopted: StarterEntry[];
  gone: StarterEntry[];
} {
  const removable: StarterEntry[] = [];
  const adopted: StarterEntry[] = [];
  const gone: StarterEntry[] = [];

  for (const entry of manifest) {
    const doc = current.get(`${entry.kind}:${entry.id}`);
    if (!doc) {
      gone.push(entry);
    } else if (starterHash(entry.kind, doc) === entry.hash) {
      removable.push(entry);
    } else {
      adopted.push(entry);
    }
  }
  return { removable, adopted, gone };
}
