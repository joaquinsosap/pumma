// Models echo fields back unchanged: asked to file a task, they helpfully
// restate its title, priority and tags as if setting them. Left alone that
// produces a diff full of "personal → personal", and — when every field is an
// echo — a whole operation that claims to change something and doesn't.
//
// So we don't trust the model's own `before`. We compare each field against
// the real current value, drop the ones that match, and rewrite `before` from
// the database. Whatever survives is a genuine change.
import type { ChangeOp, OpFields } from "@/lib/ai/changeset-schema";

/** Current values of one entity, expressed in the op vocabulary. */
export type CurrentFields = Partial<OpFields>;

const FIELD_KEYS = [
  "title",
  "description",
  "lifeArea",
  "priority",
  "frequency",
  "date",
  "projectId",
  "goalId",
  "goalIds",
  "tagNames",
  "archived",
] as const;

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const x = [...a].sort();
    const y = [...b].sort();
    return x.every((v, i) => v === y[i]);
  }
  // A date the model wrote as "2026-08-02T00:01" and we store as "2026-08-02"
  // is the same day, not an edit.
  if (typeof a === "string" && typeof b === "string") {
    return a === b || a.slice(0, 10) === b.slice(0, 10);
  }
  return a === b;
}

/**
 * Strip echoed fields and drop operations left with nothing to do.
 *
 * `current` maps a real entity id to its present values. Ids it doesn't know
 * (a create's refId) pass through untouched — there's nothing to compare to.
 */
export function normalizeOps(
  ops: ChangeOp[],
  current: Map<string, CurrentFields>,
): ChangeOp[] {
  const out: ChangeOp[] = [];

  for (const op of ops) {
    if (op.op !== "update") {
      out.push(op);
      continue;
    }

    const now = current.get(op.id);
    if (!now) {
      // Unknown target: leave it be. previewChangesetAction flags it as stale.
      out.push(op);
      continue;
    }

    const fields: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    for (const key of FIELD_KEYS) {
      const next = (op.fields as Record<string, unknown>)[key];
      // Absent and null both mean "not set" — see the schema's note.
      if (next === undefined || next === null) continue;
      const currentValue = (now as Record<string, unknown>)[key];
      if (same(next, currentValue)) continue;
      fields[key] = next;
      // The truth from the database, not what the model claimed was there.
      before[key] = currentValue ?? null;
    }

    // Every field was an echo — the operation does nothing. Drop it.
    if (!Object.keys(fields).length) continue;

    out.push({ ...op, fields, before } as ChangeOp);
  }

  return out;
}
