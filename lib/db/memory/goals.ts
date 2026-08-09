import { getStore, newId } from "@/lib/store/memory";
import { toDto, type Goal, goalSchema } from "@/lib/schemas";
import type { GoalDoc } from "@/lib/schemas";
import type { GoalCategory } from "@/lib/types";

function sortGoals(docs: GoalDoc[]): GoalDoc[] {
  return [...docs].sort(
    (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
  );
}

export function nextGoalOrder(goals: Goal[], category: GoalCategory): number {
  const inCategory = goals.filter((g) => g.category === category);
  if (!inCategory.length) return 0;
  return Math.max(...inCategory.map((g) => g.order)) + 1;
}

export async function listGoals(userId: string): Promise<Goal[]> {
  const store = getStore();
  return sortGoals(store.goals.filter((g) => g.userId === userId)).map((g) =>
    toDto(goalSchema.parse(g)),
  );
}

export async function insertGoal(
  doc: Omit<GoalDoc, "_id"> & { _id?: string },
): Promise<Goal> {
  const store = getStore();
  const full = { ...doc, _id: doc._id ?? newId() };
  store.goals.unshift(full as GoalDoc);
  return toDto(goalSchema.parse(full));
}

export async function updateGoal(
  userId: string,
  id: string,
  patch: Partial<GoalDoc>,
): Promise<Goal | null> {
  const store = getStore();
  const idx = store.goals.findIndex((g) => g._id === id && g.userId === userId);
  if (idx < 0) return null;
  store.goals[idx] = { ...store.goals[idx], ...patch };
  return toDto(goalSchema.parse(store.goals[idx]));
}

export async function deleteGoal(userId: string, id: string): Promise<boolean> {
  const store = getStore();
  const idx = store.goals.findIndex((g) => g._id === id && g.userId === userId);
  if (idx < 0) return false;
  for (const p of store.projects) {
    if (p.userId === userId && p.goalId === id) p.goalId = null;
  }
  for (const t of store.tasks) {
    if (t.userId === userId && t.goalId === id) t.goalId = null;
  }
  for (const h of store.habits) {
    if (h.userId === userId && h.goalIds.includes(id)) {
      h.goalIds = h.goalIds.filter((g) => g !== id);
    }
  }
  store.goals.splice(idx, 1);
  return true;
}

export async function updateGoalsLayout(
  userId: string,
  layout: { category: GoalCategory; ids: string[] }[],
): Promise<void> {
  const store = getStore();
  for (const { category, ids } of layout) {
    ids.forEach((id, order) => {
      const idx = store.goals.findIndex(
        (g) => g._id === id && g.userId === userId,
      );
      if (idx >= 0) {
        store.goals[idx] = { ...store.goals[idx], category, order };
      }
    });
  }
}
