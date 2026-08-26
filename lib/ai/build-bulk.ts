// Turning a resolved scope plus one patch into a changeset, in code.
//
// This is the file that makes the template guarantee true. For a bulk change
// the model writes no operations at all: it says which rows and what change,
// and every op below is constructed here from the rows the resolver picked and
// the fields the user confirmed. Same scope in, byte-identical ops out — there
// is no generation step left to vary.
//
// `before` values come from the CURRENT row rather than from anything the
// model remembered, so the old -> new the user reads is what the database
// actually holds, not what a model believed it held two calls ago.

import type {
  ChangeOp,
  Changeset,
  OpFields,
} from "@/lib/ai/changeset-schema";
import type { ScopeEntity } from "@/lib/ai/scope-schema";
import type { Goal, Habit, Note, Project, Task } from "@/lib/schemas";

/** Which patch keys mean anything for which entity. */
const PATCHABLE: Record<ScopeEntity, readonly (keyof OpFields)[]> = {
  // No `status`: opFieldsSchema has no such key and the apply path cannot set
  // one, so "mark these done" is not expressible as a change in EITHER branch
  // today. Listing it here would let the model emit a patch that silently did
  // nothing. Adding it is its own piece of work, in the changeset vocabulary
  // first.
  task: [
    "title",
    "description",
    "lifeArea",
    "priority",
    "date",
    "projectId",
    "goalId",
  ],
  habit: ["title", "lifeArea", "frequency", "archived", "goalIds"],
  goal: ["title", "lifeArea", "date"],
  project: ["title", "description", "lifeArea", "goalId"],
  note: ["title", "description", "lifeArea"],
};

/** A patch key the entity has no use for is refused, never dropped silently. */
export function checkPatch(
  entity: ScopeEntity,
  patch: OpFields,
): { ok: true } | { ok: false; error: string } {
  const allowed = PATCHABLE[entity];
  const offending = (Object.keys(patch) as (keyof OpFields)[]).filter(
    (k) => patch[k] != null && !allowed.includes(k),
  );
  if (offending.length) {
    return {
      ok: false,
      error: `${offending.join(", ")} cannot be set on a ${entity}.`,
    };
  }
  return { ok: true };
}

export type EntityLookup = {
  tasks: Map<string, Task>;
  habits: Map<string, Habit>;
  goals: Map<string, Goal>;
  projects: Map<string, Project>;
  notes: Map<string, Note>;
};

export function lookupFrom(rows: {
  tasks: Task[];
  habits: Habit[];
  goals: Goal[];
  projects: Project[];
  notes: Note[];
}): EntityLookup {
  return {
    tasks: new Map(rows.tasks.map((t) => [t.id, t])),
    habits: new Map(rows.habits.map((h) => [h.id, h])),
    goals: new Map(rows.goals.map((g) => [g.id, g])),
    projects: new Map(rows.projects.map((p) => [p.id, p])),
    notes: new Map(rows.notes.map((n) => [n.id, n])),
  };
}

/** The row's current value for each key the patch sets. */
function currentFor(
  entity: ScopeEntity,
  id: string,
  keys: (keyof OpFields)[],
  lookup: EntityLookup,
): { label: string; before: OpFields } | null {
  const before: OpFields = {};
  let label = "";

  const read = (
    source: Record<string, unknown> | undefined,
    title: string,
    map: Partial<Record<keyof OpFields, unknown>>,
  ) => {
    if (!source) return false;
    label = title;
    for (const key of keys) {
      if (key in map) (before as Record<string, unknown>)[key] = map[key];
    }
    return true;
  };

  switch (entity) {
    case "task": {
      const t = lookup.tasks.get(id);
      if (!t) return null;
      read(t as unknown as Record<string, unknown>, t.title, {
        title: t.title,
        description: t.description,
        lifeArea: t.lifeArea,
        priority: t.priority,
        date: t.due,
        projectId: t.projectId,
        goalId: t.goalId,
      });
      break;
    }
    case "habit": {
      const h = lookup.habits.get(id);
      if (!h) return null;
      read(h as unknown as Record<string, unknown>, h.name, {
        title: h.name,
        lifeArea: h.lifeArea,
        frequency: h.frequency.type,
        archived: h.archived,
        goalIds: h.goalIds,
      });
      break;
    }
    case "goal": {
      const g = lookup.goals.get(id);
      if (!g) return null;
      read(g as unknown as Record<string, unknown>, g.title, {
        title: g.title,
        lifeArea: g.lifeArea,
        date: g.targetDate,
      });
      break;
    }
    case "project": {
      const p = lookup.projects.get(id);
      if (!p) return null;
      read(p as unknown as Record<string, unknown>, p.title, {
        title: p.title,
        description: p.description,
        lifeArea: p.lifeArea,
        goalId: p.goalId,
      });
      break;
    }
    case "note": {
      const n = lookup.notes.get(id);
      if (!n) return null;
      read(n as unknown as Record<string, unknown>, n.title, {
        title: n.title,
        description: n.body,
        lifeArea: n.lifeArea,
      });
      break;
    }
  }
  return { label, before };
}

/**
 * Build the changeset for a resolved scope.
 *
 * Rows whose values already equal the patch are skipped: an op that changes
 * nothing reads on the canvas as work about to happen and then does none of
 * it, which is the single most confusing thing a diff can show.
 */
export function buildBulkChangeset(input: {
  entity: ScopeEntity;
  ids: string[];
  patch: OpFields;
  remove: boolean;
  summary: string;
  lookup: EntityLookup;
}): Changeset {
  const { entity, ids, patch, remove, lookup } = input;
  const ops: ChangeOp[] = [];
  const keys = (Object.keys(patch) as (keyof OpFields)[]).filter(
    (k) => patch[k] != null,
  );

  for (const id of ids) {
    const current = currentFor(entity, id, keys, lookup);
    // Gone since the scope resolved. Skipping beats emitting an op against a
    // row that is not there.
    if (!current) continue;

    if (remove) {
      ops.push({ op: "delete", entity, id, label: current.label });
      continue;
    }

    const changing = keys.filter(
      (k) =>
        JSON.stringify(current.before[k] ?? null) !==
        JSON.stringify(patch[k] ?? null),
    );
    if (!changing.length) continue;

    const fields: OpFields = {};
    const before: OpFields = {};
    for (const k of changing) {
      (fields as Record<string, unknown>)[k] = patch[k];
      (before as Record<string, unknown>)[k] = current.before[k] ?? null;
    }
    ops.push({ op: "update", entity, id, label: current.label, fields, before });
  }

  return { summary: input.summary, ops };
}
