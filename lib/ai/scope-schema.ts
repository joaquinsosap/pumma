// What the assistant is allowed to say about WHICH rows a bulk change touches.
//
// Pure schema — no db or SDK imports — so the scope screen (a Client
// Component) can share the types, exactly like changeset-schema.
//
// The point of this file is that the model never picks ids. It emits a
// description of a selection from the closed vocabulary below, and our own
// code resolves that against the database (see lib/scope-resolver). Three
// things follow, and all three were the actual problem:
//
//   - It cannot hallucinate an id, or quietly include a row the criteria do
//     not describe. "The 3 oldest tasks" once meant three tasks including
//     completed ones, because nothing anywhere stated what "tasks" excluded.
//   - The same spec resolves to the same rows every time. The ops are then
//     built in code, so the shape of the result cannot drift between runs the
//     way generated output does.
//   - The criteria become a thing a person can SEE and correct, because they
//     exist as data instead of living inside one model call.
import * as z from "zod/v4";

export const SCOPE_ENTITIES = [
  "task",
  "habit",
  "goal",
  "project",
  "note",
] as const;
export const scopeEntity = z.enum(SCOPE_ENTITIES);
export type ScopeEntity = z.infer<typeof scopeEntity>;

/**
 * How many of the matches to act on.
 *
 * A closed list rather than a number, because these are the counts people
 * actually say and an open integer invites the model to invent 7. "all" is
 * capped when it resolves — see ALL_CAP in the resolver.
 */
export const COUNT_CHOICES = [1, 2, 3, 5, 10, 25, "all"] as const;
export const scopeCount = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(5),
  z.literal(10),
  z.literal(25),
  z.literal("all"),
]);
export type ScopeCount = z.infer<typeof scopeCount>;

/**
 * A date window, as a phrase rather than a pair of timestamps.
 *
 * The model is bad at arithmetic on dates and good at naming the window it
 * meant; the resolver does the arithmetic against the user's own timezone.
 */
export const dateWindow = z.enum([
  "any",
  "overdue",
  "today",
  "thisWeek",
  "thisMonth",
  "undated",
]);
export type DateWindow = z.infer<typeof dateWindow>;

const lifeArea = z.enum(["personal", "work", "both"]);

/**
 * The filters, per entity.
 *
 * One flat block like opFieldsSchema, for the same reason: a discriminated
 * union per entity triples the schema the model has to hold, and the resolver
 * ignores keys that mean nothing for the entity it was given. What each key
 * means is stated for the model in the describe() text, because that text is
 * the only place it learns the vocabulary.
 */
export const scopeFiltersSchema = z.object({
  status: z
    .array(z.enum(["todo", "doing", "done"]))
    .nullish()
    .describe(
      "Tasks only. Which statuses count. For a CHANGE, leave out done unless the user asked for it, and mark 'status' assumed.",
    ),
  priority: z
    .array(z.enum(["low", "med", "high"]))
    .nullish()
    .describe("Tasks only. Which priorities count. Omit to mean any."),
  due: dateWindow
    .nullish()
    .describe(
      "Tasks only. A window on the due date. 'undated' means no due date at all.",
    ),
  frequency: z
    .array(z.enum(["daily", "weekly", "monthly"]))
    .nullish()
    .describe("Habits only. Which frequencies count."),
  archived: z
    .boolean()
    .nullish()
    .describe(
      "Habits only. false (the default) hides archived habits; true means archived ONLY.",
    ),
  category: z
    .enum(["personal", "work"])
    .nullish()
    .describe("Goals only. Which column the goal sits in."),
  target: dateWindow.nullish().describe("Goals only. A window on targetDate."),
  pinned: z.boolean().nullish().describe("Notes only. Pinned notes only."),
  edited: dateWindow.nullish().describe("Notes only. A window on updatedAt."),
  progressBelow: z
    .number()
    .min(0)
    .max(100)
    .nullish()
    .describe("Goals and projects. Percent complete strictly below this."),
  progressAbove: z
    .number()
    .min(0)
    .max(100)
    .nullish()
    .describe("Goals and projects. Percent complete strictly above this."),
  tagIds: z
    .array(z.string())
    .nullish()
    .describe("Any entity. Has ANY of these tags. Real ids from the context."),
  projectId: z
    .string()
    .nullish()
    .describe("Tasks only. Filed under this project."),
  goalId: z
    .string()
    .nullish()
    .describe("Tasks and habits. Attached to this goal."),
  lifeArea: lifeArea
    .nullish()
    .describe("Any entity. 'both' means do not filter on it."),
  contains: z
    .string()
    .nullish()
    .describe(
      "Any entity. Title contains this text, case-insensitively. Use only when the user named words to match.",
    ),
  created: dateWindow
    .nullish()
    .describe("Any entity. A window on when it was created."),
});
export type ScopeFilters = z.infer<typeof scopeFiltersSchema>;

/**
 * Orderings, shared across entities.
 *
 * `created` ascending is what "oldest" means for most things, which is the
 * one word this whole feature exists because of — and "oldest" is genuinely
 * ambiguous between created and due, so the screen asks rather than guessing
 * silently.
 */
export const SCOPE_SORTS = [
  "created",
  "due",
  "target",
  "edited",
  "priority",
  "progress",
  "alpha",
] as const;
export const scopeSort = z.enum(SCOPE_SORTS);
export type ScopeSort = z.infer<typeof scopeSort>;

/** Which sorts mean anything for which entity — the screen offers only these. */
export const SORTS_FOR: Record<ScopeEntity, readonly ScopeSort[]> = {
  task: ["created", "due", "priority", "alpha"],
  habit: ["created", "alpha"],
  goal: ["created", "target", "progress", "alpha"],
  project: ["created", "progress", "alpha"],
  note: ["edited", "created", "alpha"],
};

/** Which filter keys mean anything for which entity. Drives the screen too. */
export const FILTERS_FOR: Record<ScopeEntity, readonly (keyof ScopeFilters)[]> =
  {
    task: [
      "status",
      "priority",
      "due",
      "tagIds",
      "projectId",
      "goalId",
      "lifeArea",
      "contains",
      "created",
    ],
    habit: [
      "frequency",
      "archived",
      "tagIds",
      "goalId",
      "lifeArea",
      "contains",
      "created",
    ],
    goal: [
      "category",
      "target",
      "progressBelow",
      "progressAbove",
      "tagIds",
      "lifeArea",
      "contains",
      "created",
    ],
    project: [
      "progressBelow",
      "progressAbove",
      "tagIds",
      "lifeArea",
      "contains",
      "created",
    ],
    note: ["pinned", "edited", "tagIds", "lifeArea", "contains", "created"],
  };

/** Everything a scope can assume, by name. */
export const ASSUMABLE = [
  "entity",
  "status",
  "priority",
  "due",
  "frequency",
  "archived",
  "category",
  "target",
  "pinned",
  "edited",
  "tagIds",
  "projectId",
  "goalId",
  "lifeArea",
  "contains",
  "created",
  "progressBelow",
  "progressAbove",
  "sort",
  "count",
] as const;
export const assumedKey = z.enum(ASSUMABLE);
export type AssumedKey = z.infer<typeof assumedKey>;

/**
 * Salvage a prose entry into the key it is about.
 *
 * The enum above is the rule, but a rejected generation costs the user a whole
 * request and gives them an error instead of a screen — and what came back in
 * practice was "status: open tasks only (todo and doing)", which names its own
 * key in the first word. Taking that leading token is strictly better than
 * failing, and anything genuinely unrecognisable is dropped rather than shown
 * as a mystery.
 */
export const assumedList = z.preprocess((raw) => {
  if (!Array.isArray(raw)) return raw;
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const head = entry.split(/[:\s(]/)[0]?.trim();
    const key = (ASSUMABLE as readonly string[]).includes(head)
      ? head
      : (ASSUMABLE as readonly string[]).find((k) =>
          entry.toLowerCase().startsWith(k.toLowerCase()),
        );
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}, z.array(assumedKey));

export const scopeSchema = z.object({
  entity: scopeEntity,
  filters: scopeFiltersSchema,
  sort: z.object({
    by: scopeSort.describe("What to order by before taking `count`."),
    /** Descending. "Oldest" is created ascending, so reversed stays false. */
    reversed: z
      .boolean()
      .describe(
        "false = ascending (oldest, soonest, A to Z). true = descending (newest, latest, Z to A).",
      ),
  }),
  count: scopeCount.describe(
    "How many of the ordered matches to act on. 'all' when the user set no limit.",
  ),
  /**
   * Which of the above the model decided for itself.
   *
   * The gate for the whole screen: nothing assumed means the request was
   * fully stated and we go straight to the draft. Anything assumed means a
   * decision was made on the user's behalf, and they get to see it before it
   * touches their data.
   *
   * A CLOSED list of field names, not free text. Left open, the same request
   * came back as ["status"] one call and
   * ["status: open tasks only (todo and doing)"] the next — and the screen
   * looks these up by key to decide which control to mark, so the prose
   * version silently marked nothing. This is the same rule the rest of the
   * scope follows, applied to the one field that had escaped it: the model
   * chooses from a vocabulary, never writes one.
   */
  assumed: assumedList
    .describe(
      "Field NAMES you filled in that the user did not state, from the allowed list. Exactly the name, no explanation. This is what the user is shown and asked to confirm.",
    ),
});
export type Scope = z.infer<typeof scopeSchema>;

/** One row, as the screen shows it. Built by the resolver, never by a model. */
export type ScopeRow = {
  id: string;
  title: string;
  /** The secondary line: "added 12 Jun · to do". */
  detail: string;
  /** Present when the patch changes a field: what it is now. */
  from?: string;
};

export type ResolvedScope = {
  /** Ids the change will touch, in the resolved order. */
  ids: string[];
  /** The selected rows, for the preview. */
  rows: ScopeRow[];
  /** Matched but cut off by `count` — shown greyed, so the cut is visible. */
  excluded: ScopeRow[];
  /** How many matched the filters before `count` applied. */
  matched: number;
  /** True when `count: "all"` hit the safety cap. */
  capped: boolean;
};

/**
 * A scope, as short phrases a person can read.
 *
 * Deliberately not a sentence: these become chips, and a chip that is half a
 * sentence reads as broken. Only what NARROWS the selection appears, because
 * a chip saying "any priority" is a chip saying nothing.
 */
export function describeScope(scope: Scope): string[] {
  const out: string[] = [];
  const f = scope.filters ?? {};

  const statuses = f.status ?? [];
  if (statuses.length && statuses.length < 3) {
    out.push(
      statuses.length === 2 && !statuses.includes("done")
        ? `open ${scope.entity}s`
        : statuses.map((s) => (s === "doing" ? "in progress" : s)).join(" + "),
    );
  } else {
    out.push(`${scope.entity}s`);
  }

  if (f.priority?.length) out.push(`${f.priority.join("/")} priority`);
  if (f.due && f.due !== "any") out.push(String(f.due).replace(/([A-Z])/g, " $1").toLowerCase());
  if (f.archived) out.push("archived");
  if (f.frequency?.length) out.push(f.frequency.join("/"));
  if (f.category) out.push(f.category);
  if (f.pinned) out.push("pinned");
  if (f.lifeArea && f.lifeArea !== "both") out.push(f.lifeArea);
  if (f.contains) out.push(`“${f.contains}”`);
  if (f.tagIds?.length) {
    out.push(`${f.tagIds.length} tag${f.tagIds.length === 1 ? "" : "s"}`);
  }
  if (f.progressBelow != null) out.push(`under ${f.progressBelow}%`);
  if (f.progressAbove != null) out.push(`over ${f.progressAbove}%`);

  const order: Record<ScopeSort, [string, string]> = {
    created: ["oldest first", "newest first"],
    due: ["soonest first", "latest first"],
    target: ["soonest first", "latest first"],
    edited: ["least recent", "most recent"],
    priority: ["highest first", "lowest first"],
    progress: ["least done", "most done"],
    alpha: ["A to Z", "Z to A"],
  };
  out.push(order[scope.sort.by][scope.sort.reversed ? 1 : 0]);
  out.push(scope.count === "all" ? "all of them" : `first ${scope.count}`);
  return out;
}
