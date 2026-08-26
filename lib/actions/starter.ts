"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types";
import { requireUserId } from "@/lib/auth/session";
import { getSettings, updateSettings } from "@/lib/db/settings";
import { listTasks, deleteTask } from "@/lib/db/tasks";
import { listNotes, deleteNote } from "@/lib/db/notes";
import { listHabits, deleteHabit } from "@/lib/db/habits";
import { listGoals, deleteGoal } from "@/lib/db/goals";
import { listProjects, deleteProject } from "@/lib/db/projects";
import { listAgenda, deleteAgendaItem } from "@/lib/db/agenda";
import { partitionStarters, type StarterKind } from "@/lib/starter";

export type StarterStatus = {
  /** Still exactly as planted, so safe to remove. */
  removable: number;
  /** Rewritten since. These stay, whatever the button says. */
  adopted: number;
};

/**
 * How many examples are left, and how many have become the user's own.
 *
 * Returns null when there is nothing to offer — no manifest, or everything
 * already gone — which is what keeps the button out of Settings for accounts
 * that never had examples or have finished with them.
 */
export async function starterStatus(): Promise<StarterStatus | null> {
  const userId = await requireUserId();
  const settings = await getSettings(userId);
  const manifest = settings?.starterManifest;
  if (!manifest?.length) return null;

  const { removable, adopted } = partitionStarters(
    manifest,
    await currentDocs(userId),
  );
  if (!removable.length && !adopted.length) return null;
  return { removable: removable.length, adopted: adopted.length };
}

/**
 * Take back the examples, and only the examples.
 *
 * Three things are never touched: anything the account created itself (it was
 * never in the manifest), anything already deleted (nothing to do), and
 * anything whose words have changed since we planted it — that one is now
 * theirs, and it is reported back rather than quietly skipped, so the UI can
 * say what it left behind instead of claiming a clean sweep.
 */
export async function clearStarterContent(): Promise<
  ActionResult<{ removed: number; kept: number }>
> {
  const userId = await requireUserId();
  const settings = await getSettings(userId);
  const manifest = settings?.starterManifest;
  if (!manifest?.length) {
    return { ok: false, error: "There are no starter items to remove." };
  }

  const { removable, adopted } = partitionStarters(
    manifest,
    await currentDocs(userId),
  );

  // Children before parents: a task belongs to a project, and a habit points
  // at a goal. Removing the container first would orphan whatever is inside
  // it if a later delete failed.
  const order: StarterKind[] = [
    "task",
    "note",
    "agenda",
    "habit",
    "goal",
    "project",
  ];
  const remove = {
    task: deleteTask,
    note: deleteNote,
    agenda: deleteAgendaItem,
    habit: deleteHabit,
    goal: deleteGoal,
    project: deleteProject,
  } as const;

  let removed = 0;
  for (const kind of order) {
    for (const entry of removable.filter((e) => e.kind === kind)) {
      await remove[kind](userId, entry.id);
      removed++;
    }
  }

  // Whatever they made their own stays in the manifest, so a later edit that
  // reverts it word for word can still be cleared. Nothing left to track
  // means nothing left to offer, and the button goes away.
  await updateSettings(userId, {
    starterManifest: adopted.length ? adopted : null,
  });

  revalidatePath("/", "layout");
  return { ok: true, data: { removed, kept: adopted.length } };
}

/** Everything the manifest could possibly point at, keyed as the rule expects. */
async function currentDocs(
  userId: string,
): Promise<Map<string, Record<string, unknown>>> {
  const [tasks, notes, habits, goals, projects, agenda] = await Promise.all([
    listTasks(userId),
    listNotes(userId),
    listHabits(userId),
    listGoals(userId),
    listProjects(userId),
    listAgenda(userId),
  ]);

  const map = new Map<string, Record<string, unknown>>();
  const add = (kind: StarterKind, docs: { id: string }[]) => {
    for (const doc of docs) {
      map.set(`${kind}:${doc.id}`, doc as unknown as Record<string, unknown>);
    }
  };
  add("task", tasks);
  add("note", notes);
  add("habit", habits);
  add("goal", goals);
  add("project", projects);
  add("agenda", agenda);
  return map;
}
