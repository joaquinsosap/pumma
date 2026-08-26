"use server";

import type { ActionResult } from "@/lib/types";
import type { Changeset, OpFields } from "@/lib/ai/changeset-schema";
import type { ResolvedScope, Scope } from "@/lib/ai/scope-schema";
import { scopeSchema } from "@/lib/ai/scope-schema";
import { opFieldsSchema } from "@/lib/ai/changeset-schema";
import { requireUserId } from "@/lib/auth/session";
import { resolveScopeFor } from "@/lib/ai/assist";
import { buildBulkChangeset, checkPatch, lookupFrom } from "@/lib/ai/build-bulk";
import { listTasks } from "@/lib/db/tasks";
import { listHabits } from "@/lib/db/habits";
import { listGoals } from "@/lib/db/goals";
import { listProjects } from "@/lib/db/projects";
import { listNotes } from "@/lib/db/notes";

/**
 * What this scope currently selects.
 *
 * Called on every chip the user touches, so the preview shows real rows rather
 * than a promise about them. No AI, no writes: this is the same resolver the
 * assistant used, run again against fresh data.
 */
export async function resolveScopeAction(
  scope: Scope,
): Promise<ActionResult<ResolvedScope>> {
  const parsed = scopeSchema.safeParse(scope);
  if (!parsed.success) return { ok: false, error: "Invalid selection" };
  const userId = await requireUserId();
  return { ok: true, data: await resolveScopeFor(userId, parsed.data) };
}

/**
 * Turn a confirmed scope into the draft the canvas renders.
 *
 * The changeset is BUILT here rather than generated, from the rows the
 * resolver picks and the fields the user confirmed, with `before` read from
 * the current row. That is the whole point of the detour: by this stage no
 * model output remains in the result.
 */
export async function draftFromScopeAction(input: {
  scope: Scope;
  patch: OpFields;
  remove: boolean;
  summary: string;
}): Promise<ActionResult<Changeset>> {
  const scope = scopeSchema.safeParse(input.scope);
  const patch = opFieldsSchema.safeParse(input.patch);
  if (!scope.success || !patch.success) {
    return { ok: false, error: "Invalid selection" };
  }

  const check = checkPatch(scope.data.entity, patch.data);
  if (!check.ok) return { ok: false, error: check.error };

  // Neither a change nor a removal. Reachable when the model meant to delete
  // and did not say so, and an empty draft would be a baffling way to find
  // that out.
  const patches = Object.values(patch.data).some((v) => v != null);
  if (!input.remove && !patches) {
    return { ok: false, error: "That request did not describe a change." };
  }

  const userId = await requireUserId();
  const resolved = await resolveScopeFor(userId, scope.data);
  if (!resolved.ids.length) {
    return { ok: false, error: "Nothing matches those filters." };
  }

  const [tasks, habits, goals, projects, notes] = await Promise.all([
    listTasks(userId),
    listHabits(userId),
    listGoals(userId),
    listProjects(userId),
    listNotes(userId),
  ]);

  const changeset = buildBulkChangeset({
    entity: scope.data.entity,
    ids: resolved.ids,
    patch: patch.data,
    remove: input.remove,
    summary: input.summary,
    lookup: lookupFrom({ tasks, habits, goals, projects, notes }),
  });

  if (!changeset.ops.length) {
    return {
      ok: false,
      error: input.remove
        ? "Nothing matches those filters."
        : "Those rows already have that value.",
    };
  }
  return { ok: true, data: changeset };
}
