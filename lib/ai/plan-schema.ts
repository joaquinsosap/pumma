// Pure schema for the AI planner. No db/SDK imports — safe to import from
// Client Components (the preview) for types.
//
// Authored against zod/v4 (the implementation zod 3.25 ships under this subpath)
// because the Anthropic SDK's `zodOutputFormat` helper expects a v4 schema.
import * as z from "zod/v4";

const lifeArea = z.enum(["personal", "work"]);

// A *Ref holds EITHER a plan-local refId (short token like "g1") OR an existing
// entity's real hex id (which the model is given in context). Short refIds never
// collide with 24-char hex ids.
export const planSchema = z.object({
  summary: z.string(),
  goals: z.array(
    z.object({
      refId: z.string(),
      title: z.string(),
      category: z.enum(["personal", "work"]),
      lifeArea,
      metricLabel: z.string().nullable().optional(),
      targetDate: z.string().nullable().optional(),
    }),
  ),
  projects: z.array(
    z.object({
      refId: z.string(),
      title: z.string(),
      description: z.string().nullable().optional(),
      lifeArea,
      goalRef: z.string().nullable().optional(),
      bestPractices: z.array(z.string()).nullable().optional(),
    }),
  ),
  habits: z.array(
    z.object({
      refId: z.string(),
      name: z.string(),
      frequency: z.enum(["daily", "weekly", "monthly"]),
      lifeArea,
      goalRefs: z.array(z.string()),
      goalTargetStreak: z.number().nullable().optional(),
    }),
  ),
  tasks: z.array(
    z.object({
      refId: z.string(),
      title: z.string(),
      description: z.string().nullable().optional(),
      priority: z.enum(["low", "med", "high"]),
      lifeArea,
      projectRef: z.string().nullable().optional(),
      goalRef: z.string().nullable().optional(),
      due: z.string().nullable().optional(),
      tagNames: z.array(z.string()).nullable().optional(),
      subtasks: z.array(z.string()).nullable().optional(),
    }),
  ),
  notes: z.array(
    z.object({
      refId: z.string(),
      title: z.string(),
      body: z.string(),
      lifeArea,
      tagNames: z.array(z.string()).nullable().optional(),
    }),
  ),
});

export type PlanGraph = z.infer<typeof planSchema>;

/** Minimal existing entities, passed to the preview so it can label cross-links. */
export type ExistingEntities = {
  goals: { id: string; title: string }[];
  projects: { id: string; title: string }[];
};

/** What the interpret action returns: the plan plus context for rendering it. */
export type PlanResult = { plan: PlanGraph; existing: ExistingEntities };

export type PlanGoal = PlanGraph["goals"][number];
export type PlanProject = PlanGraph["projects"][number];
export type PlanHabit = PlanGraph["habits"][number];
export type PlanTask = PlanGraph["tasks"][number];
export type PlanNote = PlanGraph["notes"][number];
