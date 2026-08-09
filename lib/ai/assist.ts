// Server-only: the unified assistant call. One request, and the model commits
// to an answer or a changeset via the schema's discriminator.
import "server-only";
import { buildUserSnapshot } from "@/lib/ai/user-snapshot";
import { ASSISTANT_CONTEXT, contextForMode } from "@/lib/ai/assistant-context";
import { enrichAskAnswer } from "@/lib/ai/enrich-ask";
import type { AskAnswer } from "@/lib/ai/ask-schema";
import type { Changeset } from "@/lib/ai/changeset-schema";
import { schemaForMode, type AssistantMode } from "@/lib/ai/assistant-schema";
import { generateStructured } from "@/lib/ai/generate";
import { normalizeOps, type CurrentFields } from "@/lib/ai/normalize-changeset";
import { listTasks } from "@/lib/db/tasks";
import { listProjects } from "@/lib/db/projects";
import { listGoals } from "@/lib/db/goals";
import { listHabits } from "@/lib/db/habits";
import { listNotes } from "@/lib/db/notes";
import { listTags } from "@/lib/db/tags";

export type AssistOutcome =
  | { kind: "answer"; answer: AskAnswer; dataMode: "full" | "trimmed" }
  | { kind: "changeset"; changeset: Changeset };

export async function assist(
  userId: string,
  text: string,
  mode: AssistantMode = "auto",
): Promise<AssistOutcome> {
  const { json, dataMode, data } = await buildUserSnapshot(userId);

  const { object } = await generateStructured({
    userId,
    // A pinned mode narrows the schema to that branch — see schemaForMode.
    schema: schemaForMode(mode),
    system: {
      // A pinned mode gets a prompt that only describes that mode, and a
      // schema narrowed to match — telling a model "ignore the routing rules"
      // while still handing it the rules does not work.
      cacheable: contextForMode(mode),
      volatile: `# The user's data (JSON)\n${json}`,
    },
    prompt: text,
    maxTokens: 16000,
    tooLongMessage:
      "The result was too large to generate. Try a shorter or more focused request.",
    refusalMessage: "The model declined this request.",
    invalidMessage:
      "The model did not return a usable result. Please try again.",
  });

  const response = object.response;
  if (response.kind === "answer") {
    const { widgets, answer } = response;
    return {
      kind: "answer",
      answer: enrichAskAnswer({ answer, widgets }, data),
      dataMode,
    };
  }
  return {
    kind: "changeset",
    changeset: {
      summary: response.summary,
      ops: normalizeOps(response.ops, await currentFields(userId)),
    },
  };
}

/**
 * Rewrite one subtree of a draft changeset. The response replaces exactly the
 * ops passed in — the rest of the canvas is never part of the conversation, so
 * it cannot drift.
 */
export async function repromptSubtree(
  userId: string,
  input: {
    intent: string;
    instruction: string;
    subtree: Changeset["ops"];
    context: string[];
  },
): Promise<Changeset["ops"]> {
  const { changesetSchema } = await import("@/lib/ai/changeset-schema");
  const subtreeSchema = changesetSchema.pick({ ops: true });

  const { object } = await generateStructured({
    userId,
    schema: subtreeSchema,
    system: {
      cacheable: ASSISTANT_CONTEXT,
      volatile: [
        "# Node-scoped rewrite",
        [
          "You are rewriting ONE SUBTREE of a draft changeset. Your ops REPLACE the subtree below wholesale — whatever you leave out ceases to exist.",
          "",
          "So: return the FULL subtree after the change, not just the new parts. That means the root node itself (first op, same refId as now unless the instruction says to split or remove it), then every child that should survive — unchanged ones included, copied as they are.",
          "Children must keep pointing at their parent — a task through `projectId`, a project through `goalId`. A child with neither becomes a loose top-level node, which is almost never what the instruction meant.",
          "Keep refIds stable for ops that survive; mint new ones only for genuinely new ops.",
          "The scaffolding rule still applies: structure only, the user's words only.",
        ].join("\n"),
        `Original request: ${input.intent}`,
        `Other nodes in the draft (do not recreate these): ${input.context.join("; ") || "none"}`,
        `Current subtree (the root node is first):\n${JSON.stringify(input.subtree, null, 2)}`,
      ].join("\n\n"),
    },
    prompt: input.instruction,
    maxTokens: 8000,
    tooLongMessage: "The rewrite was too large. Try a smaller instruction.",
    refusalMessage: "The model declined this rewrite.",
    invalidMessage:
      "The model did not return a usable rewrite. Please try again.",
  });

  return object.ops;
}

/**
 * Every entity's present values, keyed by id, in the op vocabulary — what a
 * proposed update is measured against.
 */
async function currentFields(
  userId: string,
): Promise<Map<string, CurrentFields>> {
  const [tasks, projects, goals, habits, notes, tags] = await Promise.all([
    listTasks(userId),
    listProjects(userId),
    listGoals(userId),
    listHabits(userId),
    listNotes(userId),
    listTags(userId),
  ]);
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const names = (ids: string[]) =>
    ids.map((id) => tagName.get(id)).filter((n): n is string => Boolean(n));

  const map = new Map<string, CurrentFields>();
  for (const g of goals) {
    map.set(g.id, {
      title: g.title,
      lifeArea: g.lifeArea === "work" ? "work" : "personal",
      date: g.targetDate ?? undefined,
    });
  }
  for (const p of projects) {
    map.set(p.id, {
      title: p.title,
      description: p.description,
      lifeArea: p.lifeArea === "work" ? "work" : "personal",
      goalId: p.goalId ?? undefined,
    });
  }
  for (const h of habits) {
    map.set(h.id, {
      title: h.name,
      frequency: h.frequency.type as CurrentFields["frequency"],
      lifeArea: h.lifeArea === "work" ? "work" : "personal",
      goalIds: h.goalIds,
      archived: h.archived,
    });
  }
  for (const t of tasks) {
    map.set(t.id, {
      title: t.title,
      description: t.description,
      priority: t.priority,
      date: t.due ?? undefined,
      lifeArea: t.lifeArea === "work" ? "work" : "personal",
      projectId: t.projectId ?? undefined,
      tagNames: names(t.tagIds),
    });
  }
  for (const n of notes) {
    map.set(n.id, {
      title: n.title,
      description: n.body,
      lifeArea: n.lifeArea === "work" ? "work" : "personal",
      tagNames: names(n.tagIds),
    });
  }
  return map;
}
