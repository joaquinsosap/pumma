"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types";
import type { Goal, Project } from "@/lib/schemas";
import { newId } from "@/lib/store/memory";
import { requireUserId } from "@/lib/auth/session";
import { AI_QUOTA_MESSAGE, reserveAiCall } from "@/lib/ai/quota";
import { iso } from "@/lib/date";
import { userToday } from "@/lib/timezone-server";
import { interpret } from "@/lib/ai/interpret";
import { ask } from "@/lib/ai/ask";
import { planSchema, type PlanGraph, type PlanResult } from "@/lib/ai/plan-schema";
import type { AskResult } from "@/lib/ai/ask-schema";
import { insertGoal, listGoals, nextGoalOrder } from "@/lib/db/goals";
import { insertProject, listProjects } from "@/lib/db/projects";
import { insertHabit } from "@/lib/db/habits";
import { insertTask } from "@/lib/db/tasks";
import { insertNote } from "@/lib/db/notes";
import { ensureTags, listTags } from "@/lib/db/tags";
import { pickProjectColor } from "@/lib/project-colors";
import { aiInput } from "@/lib/validation";
import {
  deriveLifeAreaFromTags,
  setLifeTags,
} from "@/lib/life-area-sync";

const HABIT_COLOR = "oklch(0.6 0.13 155)";

export async function interpretIntent(
  intent: string
): Promise<ActionResult<PlanResult>> {
  const parsed = aiInput.safeParse(intent);
  if (!parsed.success) {
    return { ok: false, error: "Describe what you want to plan (3–2000 characters)." };
  }
  const userId = await requireUserId();
  if (!(await reserveAiCall(userId))) {
    return { ok: false, error: AI_QUOTA_MESSAGE };
  }
  try {
    const result = await interpret(userId, parsed.data);
    return { ok: true, data: result };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to generate a plan.",
    };
  }
}

export async function askAssistant(
  question: string
): Promise<ActionResult<AskResult>> {
  const parsed = aiInput.safeParse(question);
  if (!parsed.success) {
    return { ok: false, error: "Ask a question about your data (3–2000 characters)." };
  }
  const userId = await requireUserId();
  if (!(await reserveAiCall(userId))) {
    return { ok: false, error: AI_QUOTA_MESSAGE };
  }
  try {
    return { ok: true, data: await ask(userId, parsed.data) };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to answer.",
    };
  }
}

type ApplyCounts = {
  goals: number;
  projects: number;
  habits: number;
  tasks: number;
  notes: number;
};

export async function applyPlan(
  plan: PlanGraph
): Promise<ActionResult<ApplyCounts>> {
  // Never trust the client — re-validate the plan shape.
  const parsed = planSchema.safeParse(plan);
  if (!parsed.success) return { ok: false, error: "Invalid plan." };
  const data = parsed.data;

  const userId = await requireUserId();
  const { today: td } = await userToday();

  const [existingGoals, existingProjects] = await Promise.all([
    listGoals(userId),
    listProjects(userId),
  ]);
  const existingGoalIds = new Set(existingGoals.map((g) => g.id));
  const existingProjectIds = new Set(existingProjects.map((p) => p.id));

  const goalIdByRef = new Map<string, string>();
  const projectIdByRef = new Map<string, string>();

  // Resolve a ref to a real id: a plan ref we just created, an existing id, else null.
  const resolveGoal = (ref?: string | null): string | null =>
    ref ? goalIdByRef.get(ref) ?? (existingGoalIds.has(ref) ? ref : null) : null;
  const resolveProject = (ref?: string | null): string | null =>
    ref
      ? projectIdByRef.get(ref) ?? (existingProjectIds.has(ref) ? ref : null)
      : null;

  // Life tags are attached to everything the plan creates, so the personal /
  // work split reads the same way as it does for hand-made items.
  const tags = await listTags(userId);

  const counts: ApplyCounts = { goals: 0, projects: 0, habits: 0, tasks: 0, notes: 0 };

  try {
    // 1. Goals (orders recomputed as we add so same-category goals don't collide).
    const goalAccum: Goal[] = [...existingGoals];
    for (const g of data.goals) {
      const created = await insertGoal({
        userId,
        title: g.title,
        category: g.category,
        metricLabel: g.metricLabel ?? "",
        progress: 0,
        targetDate: g.targetDate ?? null,
        // Tags carry the life area; the column mirrors them.
        tagIds: setLifeTags([], g.category, tags),
        lifeArea: g.category,
        order: nextGoalOrder(goalAccum, g.category),
        createdAt: td,
      });
      goalIdByRef.set(g.refId, created.id);
      goalAccum.push(created);
      counts.goals++;
    }

    // 2. Projects (color picked against the growing set).
    const projectAccum: Project[] = [...existingProjects];
    for (const p of data.projects) {
      const bp = p.bestPractices ?? [];
      const description = [
        p.description ?? "",
        bp.length ? `Best practices:\n${bp.map((b) => `- ${b}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const created = await insertProject({
        userId,
        title: p.title,
        description,
        color: pickProjectColor(projectAccum),
        progress: 0,
        label: "0/0",
        goalId: resolveGoal(p.goalRef),
        tagIds: setLifeTags([], p.lifeArea, tags),
        lifeArea: p.lifeArea,
        createdAt: td,
      });
      projectIdByRef.set(p.refId, created.id);
      projectAccum.push(created);
      counts.projects++;
    }

    // 3. Habits.
    for (let i = 0; i < data.habits.length; i++) {
      const h = data.habits[i];
      const goalIds = h.goalRefs
        .map((ref) => resolveGoal(ref))
        .filter((id): id is string => id !== null);
      await insertHabit({
        userId,
        name: h.name,
        color: HABIT_COLOR,
        frequency: { type: h.frequency, target: 1 },
        order: i,
        archived: false,
        goalIds,
        goalTargetStreak: h.goalTargetStreak ?? null,
        tagIds: setLifeTags([], h.lifeArea, tags),
        lifeArea: h.lifeArea,
        createdAt: td,
      });
      counts.habits++;
    }

    // 4. Tasks.
    for (const t of data.tasks) {
      const tagNames = t.tagNames ?? [];
      const tagIds = await ensureTags(userId, tagNames);
      // ensureTags returns ids in the same order as tagNames, so zip them
      // back up for the derive rule — no extra DB round-trip needed.
      const tagRefs = tagIds.map((id, i) => ({ id, name: tagNames[i] }));
      const subtasks = (t.subtasks ?? []).map((title) => ({
        id: newId(),
        title,
        done: false,
      }));
      await insertTask({
        userId,
        title: t.title,
        description: t.description ?? "",
        subtasks,
        tagIds,
        priority: t.priority,
        status: "todo",
        due: t.due ?? td,
        projectId: resolveProject(t.projectRef),
        goalId: resolveGoal(t.goalRef),
        lifeArea: deriveLifeAreaFromTags(tagIds, tagRefs),
        order: -Date.now(),
        createdAt: td,
        completedAt: null,
      });
      counts.tasks++;
    }

    // 5. Notes.
    for (const n of data.notes) {
      const tagNames = n.tagNames ?? [];
      const tagIds = await ensureTags(userId, tagNames);
      const tagRefs = tagIds.map((id, i) => ({ id, name: tagNames[i] }));
      await insertNote({
        userId,
        title: n.title,
        body: n.body,
        tagIds,
        pinned: false,
        lifeArea: deriveLifeAreaFromTags(tagIds, tagRefs),
        createdAt: td,
        updatedAt: td,
      });
      counts.notes++;
    }
  } catch {
    return { ok: false, error: "Failed to create some items. Please try again." };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: counts };
}
