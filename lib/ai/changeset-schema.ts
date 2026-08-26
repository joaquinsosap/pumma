// The changeset half of the assistant: typed operations against the world
// that exists, not a description of a new one. Pure schema — no db/SDK
// imports, so the canvas (a Client Component) can share the types.
//
// One flat fields block serves all five entities; which keys mean anything
// depends on the entity. Keys are optional AND nullable: a model asked to
// change a task's priority sends { priority } and nothing else — but when it
// does mention a field it isn't setting, it writes null rather than omitting
// it. Both mean "not set", and rejecting one of them fails whole generations.
//
// (An earlier version made every key required with sentinel values, to satisfy
// Anthropic's structured-output grammar caps. Those caps only apply to
// grammar-compiled outputs; we send the schema as a tool input_schema instead
// — see lib/ai/generate.ts — where they don't exist.)
import * as z from "zod/v4";

const entity = z.enum(["goal", "project", "habit", "task", "note", "meeting"]);

/**
 * The one fields block. An absent key means "not set" on a create and
 * "unchanged" on an update.
 *
 * Per entity: `title` is a habit's name; `description` is a note's body;
 * `date` is a task's due or a goal's targetDate; `projectId`/`goalId` file
 * things where they belong — named exactly as the snapshot names them.
 */
export const opFieldsSchema = z.object({
  title: z
    .string()
    .nullish()
    .describe("Name of the goal/project/task/note, or the habit's name."),
  description: z
    .string()
    .nullish()
    .describe(
      "Longer text for a project or task; for a note this is its body.",
    ),
  lifeArea: z
    .enum(["personal", "work"])
    .nullish()
    .describe("Which side of life this belongs to."),
  priority: z.enum(["low", "med", "high"]).nullish().describe("Task priority."),
  status: z
    .enum(["todo", "doing", "done"])
    .nullish()
    .describe(
      "Task status. Setting it to done also stamps the completion date; moving it back off done clears that stamp.",
    ),
  frequency: z
    .enum(["daily", "weekly", "monthly"])
    .nullish()
    .describe("How often a habit repeats."),
  date: z
    .string()
    .nullish()
    .describe(
      "YYYY-MM-DD. A task's due date, a goal's target date, or a meeting's date (the START date when it repeats).",
    ),
  // These carry the same names the snapshot uses for the same links. The model
  // reads tasks with a projectId and projects with a goalId, and reaches for
  // those words when it writes ops — a differently-named field here just gets
  // dropped as an unknown key, leaving an update that changes nothing.
  projectId: z
    .string()
    .nullish()
    .describe(
      "For a task: the project it belongs to. Set this to move a task into a project. Accepts a real project id from the snapshot, or the refId of a project created in this same changeset.",
    ),
  goalId: z
    .string()
    .nullish()
    .describe(
      "For a project: the goal it belongs to. Accepts a real goal id, or the refId of a goal created in this same changeset.",
    ),
  goalIds: z
    .array(z.string())
    .nullish()
    .describe("For a habit: the goals it feeds. Real ids or refIds."),
  tagNames: z
    .array(z.string())
    .nullish()
    .describe("Tag names for a task or note. Plain words, no # prefix."),
  time: z
    .string()
    .nullish()
    .describe("For a meeting: start time as HH:MM on a 24 hour clock."),
  durationMins: z
    .number()
    .int()
    .nullish()
    .describe("For a meeting: how long it runs, in minutes. Default 30."),
  // One rule carries ONE time, which is the thing to get right when somebody
  // asks for "Mondays at 17 and Wednesdays at 18": that is two meetings, each
  // with its own weekly rule, not one rule listing two days. Said here
  // because this description is what the model actually reads.
  repeat: z
    .object({
      freq: z.enum(["daily", "weekly", "monthly"]),
      interval: z
        .number()
        .int()
        .min(1)
        .max(52)
        .nullish()
        .describe("Every N days/weeks/months. Default 1."),
      byWeekday: z
        .array(z.number().int().min(0).max(6))
        .nullish()
        .describe(
          "Weekly only. 0=Sunday through 6=Saturday. Every day listed here happens at the SAME time; if the user wants different times on different days, emit one meeting per time instead.",
        ),
      until: z
        .string()
        .nullish()
        .describe("YYYY-MM-DD, inclusive last day, or omit for no end."),
      count: z
        .number()
        .int()
        .min(1)
        .max(730)
        .nullish()
        .describe("Stop after N occurrences, or omit."),
    })
    .nullish()
    .describe(
      "For a meeting: how it repeats. Omit for a one-off. `date` is the series start.",
    ),
  archived: z
    .boolean()
    .nullish()
    .describe(
      "For a habit: true to archive it (stop tracking without deleting its history), false to bring it back. Archiving is the gentle alternative to deleting.",
    ),
});

export const createOpSchema = z.object({
  op: z.literal("create"),
  entity,
  /** Plan-local handle ("p1") so later ops can reference this creation. */
  refId: z.string(),
  fields: opFieldsSchema,
});

export const updateOpSchema = z.object({
  op: z.literal("update"),
  entity,
  /** The real id, from the context the model was shown. */
  id: z.string(),
  /** Display name, so the diff reads without a lookup. */
  label: z.string(),
  fields: opFieldsSchema,
  /**
   * The old values of exactly the fields being changed — set keys mirror
   * `fields`, everything else stays at its sentinel. The UI renders old → new
   * from here, never from a re-fetch.
   */
  before: opFieldsSchema,
});

export const deleteOpSchema = z.object({
  op: z.literal("delete"),
  entity,
  id: z.string(),
  label: z.string(),
});

export const changeOpSchema = z.discriminatedUnion("op", [
  createOpSchema,
  updateOpSchema,
  deleteOpSchema,
]);

export const changesetSchema = z.object({
  /** One line, said to the user: what this draft is. */
  summary: z.string(),
  ops: z.array(changeOpSchema),
});

export type OpFields = z.infer<typeof opFieldsSchema>;
export type ChangeOp = z.infer<typeof changeOpSchema>;
export type CreateOp = z.infer<typeof createOpSchema>;
export type UpdateOp = z.infer<typeof updateOpSchema>;
export type DeleteOp = z.infer<typeof deleteOpSchema>;
export type Changeset = z.infer<typeof changesetSchema>;
export type ChangeEntity = z.infer<typeof entity>;

/** An empty fields block, for ops the user adds by hand on the canvas. */
export function blankOpFields(): OpFields {
  return {};
}
