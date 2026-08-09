// Pure schema for the "Ask" assistant: the AI answers a question about the user's
// own data and lays the answer out as a grid of gadgets. No db/SDK imports, so the
// client dashboard can import these types. Authored against zod/v4 for zodOutputFormat.
import * as z from "zod/v4";

// No .nullable()/.nullish() anywhere: Anthropic's structured-output grammar
// caps optional parameters (24) and union-typed parameters, nullable included
// (16). "" means "none" for every string field; "none" is an enum member.

// Grid width (columns) the AI assigns each gadget: "1", "2" or "3". A string
// enum, not a number union — unions count against the grammar limit.
const span = z.enum(["1", "2", "3"]);

const textWidget = z.object({
  type: z.literal("text"),
  title: z.string(),
  span,
  body: z.string(),
});

const statWidget = z.object({
  type: z.literal("stat"),
  title: z.string(),
  span,
  value: z.string(), // string so "78%", "12 days", "3 / 8" all work
  /** "" = none. */
  label: z.string(),
  hint: z.string(),
});

const entityKind = z.enum(["task", "project", "goal", "habit", "note", "none"]);

/** Deep-link fields. "none"/"" when the item isn't a specific entity. */
const focusFields = {
  entityKind,
  entityId: z.string(),
  href: z.string(),
};

const barWidget = z.object({
  type: z.literal("bar"),
  title: z.string(),
  span,
  unit: z.string(),
  /**
   * True when the same series would read equally well as a donut. The app
   * uses it to vary the dashboard: a second consecutive bar chart becomes a
   * pie when you say the data supports it. (Sent via jsonTool, so nullish is
   * safe here despite the file-top note about grammar caps.)
   */
  altPie: z
    .boolean()
    .nullish()
    .describe(
      "True if this exact series would also read well as a donut (parts of a whole). The app may then render it as one for variety.",
    ),
  series: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
      ...focusFields,
    }),
  ),
});

const listWidget = z.object({
  type: z.literal("list"),
  title: z.string(),
  span,
  items: z.array(
    z.object({
      label: z.string(),
      sublabel: z.string(),
      ...focusFields,
    }),
  ),
});

const calendarWidget = z.object({
  type: z.literal("calendar"),
  title: z.string(),
  span,
  month: z.string(), // "YYYY-MM"
  marks: z.array(
    z.object({
      date: z.string(), // "YYYY-MM-DD"
      intensity: z.number(), // 0..1 shading; 0 = default
      label: z.string(),
    }),
  ),
});

const tableWidget = z.object({
  type: z.literal("table"),
  title: z.string(),
  span,
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});

const pieWidget = z.object({
  type: z.literal("pie"),
  title: z.string(),
  span,
  // Donut slices. Values are absolute (hours, counts) — the widget derives the
  // percentages, so the legend can show both without the model doing division.
  slices: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
      ...focusFields,
    }),
  ),
  unit: z.string(),
  centerLabel: z.string(),
  /** Mirror of barWidget.altPie: this donut could also be a bar ranking. */
  altBar: z
    .boolean()
    .nullish()
    .describe(
      "True if these slices would also read well as a ranked bar chart. The app may then render it as one for variety.",
    ),
});

const lineWidget = z.object({
  type: z.literal("line"),
  title: z.string(),
  span,
  points: z.array(z.object({ label: z.string(), value: z.number() })),
  unit: z.string(),
});

const progressWidget = z.object({
  type: z.literal("progress"),
  title: z.string(),
  span,
  rows: z.array(
    z.object({
      label: z.string(),
      // 0..100
      percent: z.number(),
      ...focusFields,
    }),
  ),
});

export const widgetSchema = z.discriminatedUnion("type", [
  textWidget,
  statWidget,
  barWidget,
  listWidget,
  calendarWidget,
  tableWidget,
  pieWidget,
  lineWidget,
  progressWidget,
]);

export const askAnswerSchema = z.object({
  answer: z.string(),
  widgets: z.array(widgetSchema),
});

export type Widget = z.infer<typeof widgetSchema>;
export type AskAnswer = z.infer<typeof askAnswerSchema>;

/** What the ask action returns: the model answer plus which data slice was sent. */
export type AskResult = AskAnswer & { dataMode: "full" | "trimmed" };
