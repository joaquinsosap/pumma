// Server-only: asks the user's chosen model to turn an intent into a structured
// PlanGraph. The `server-only` guard ensures no provider SDK can leak into a
// Client Component bundle (see the data-layer client/server boundary).
import "server-only";
import { listGoals } from "@/lib/db/goals";
import { listProjects } from "@/lib/db/projects";
import {
  DOMAIN_CONTEXT,
  formatExistingEntities,
} from "@/lib/ai/domain-context";
import { planSchema, type PlanResult } from "@/lib/ai/plan-schema";
import { generateStructured } from "@/lib/ai/generate";

export async function interpret(
  userId: string,
  intent: string,
): Promise<PlanResult> {
  const [goals, projects] = await Promise.all([
    listGoals(userId),
    listProjects(userId),
  ]);
  const existing = formatExistingEntities(goals, projects);

  const { object } = await generateStructured({
    userId,
    schema: planSchema,
    // The static block is the cacheable one; what the user already has changes
    // between calls and must stay outside the cached prefix.
    system: { cacheable: DOMAIN_CONTEXT, volatile: existing },
    prompt: intent,
    maxTokens: 16000,
    tooLongMessage:
      "The plan was too large to generate. Try a shorter or more focused intent.",
    refusalMessage: "The model declined to generate a plan for this request.",
    invalidMessage: "The model did not return a valid plan. Please try again.",
  });

  return {
    plan: object,
    existing: {
      goals: goals.map((g) => ({ id: g.id, title: g.title })),
      projects: projects.map((p) => ({ id: p.id, title: p.title })),
    },
  };
}
