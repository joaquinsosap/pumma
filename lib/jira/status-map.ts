// Which Jira status is which PUMMA column, and which Jira status each column
// sends back. Pure: the rules are read and tested here, while storing the map
// and asking Jira live elsewhere.

import { z } from "zod";
import type { JiraStage } from "@/lib/jira/issue";
import type { ColumnOf, TaskColumn } from "@/lib/jira/status-sync";

export const COLUMNS = ["todo", "doing", "done"] as const satisfies readonly TaskColumn[];

/** A status the tables list, with the bucket Jira sorts it in. */
export type KnownStatus = { name: string; stage: JiraStage | null };

export type JiraStatusMap = {
  /** His answer for a status, kept only where it differs from Jira's own sorting. */
  from: Record<string, TaskColumn>;
  /** The Jira status each column sends. Null leaves Jira alone. */
  to: Record<TaskColumn, string | null>;
  /** Every status the tables list, in the order they were first met. */
  known: KnownStatus[];
};

/** Jira's own names are short; this bounds what a stored map can hold. */
export const STATUS_NAME_MAX = 60;
export const KNOWN_MAX = 200;

const column = z.enum(COLUMNS);
const statusName = z.string().trim().min(1).max(STATUS_NAME_MAX);

export const statusMapSchema = z.object({
  from: z
    .record(statusName, column)
    .refine((from) => Object.keys(from).length <= KNOWN_MAX, "Too many statuses")
    .default({}),
  to: z
    .object({
      todo: statusName.nullable().default(null),
      doing: statusName.nullable().default(null),
      done: statusName.nullable().default(null),
    })
    .default({}),
  known: z
    .array(z.object({ name: statusName, stage: column.nullable().default(null) }))
    .max(KNOWN_MAX)
    .default([]),
});

export function emptyStatusMap(): JiraStatusMap {
  return { from: {}, to: { todo: null, doing: null, done: null }, known: [] };
}

/** A stored or sent map, or the empty one when it is not one. Each status is listed once. */
export function readStatusMap(raw: unknown): JiraStatusMap {
  const parsed = statusMapSchema.safeParse(raw);
  if (!parsed.success) return emptyStatusMap();
  const seen = new Set<string>();
  const known = parsed.data.known.filter((k) => {
    if (seen.has(k.name)) return false;
    seen.add(k.name);
    return true;
  });
  return { from: parsed.data.from, to: parsed.data.to, known };
}

/**
 * The column a status lands in: his answer when he gave one, else the bucket
 * Jira sorts it in. `stage` is what Jira said on this read; without it the
 * bucket the tables last saw is used. Null when nothing says.
 */
export function columnOfStatus(
  map: JiraStatusMap,
  name: string,
  stage?: JiraStage | null,
): TaskColumn | null {
  const mine = map.from[name];
  if (mine) return mine;
  if (stage) return stage;
  return map.known.find((k) => k.name === name)?.stage ?? null;
}

/** The reading rule for a sync: where each ticket's status lands. */
export function columnOfWith(map: JiraStatusMap): ColumnOf {
  return (status) => columnOfStatus(map, status.name, status.stage);
}

/** The map with his answer for one status. An answer equal to Jira's sorting is no override, and is dropped. */
export function withAnswer(
  map: JiraStatusMap,
  name: string,
  answer: TaskColumn,
): JiraStatusMap {
  const jiras = map.known.find((k) => k.name === name)?.stage ?? null;
  const from = { ...map.from };
  if (answer === jiras) delete from[name];
  else from[name] = answer;
  return { ...map, from };
}

/**
 * The map with every status in `found` listed. Null when there is nothing new,
 * so a read that met only familiar statuses writes nothing.
 */
export function withKnown(
  map: JiraStatusMap,
  found: Iterable<KnownStatus>,
): JiraStatusMap | null {
  const known = map.known.map((k) => ({ ...k }));
  let changed = false;
  for (const status of found) {
    const name = status.name.trim().slice(0, STATUS_NAME_MAX);
    if (!name) continue;
    const there = known.find((k) => k.name === name);
    if (there) {
      // Jira's sorting is its own to change: a status moved to another bucket is listed under the new one.
      if (status.stage && there.stage !== status.stage) {
        there.stage = status.stage;
        changed = true;
      }
      continue;
    }
    if (known.length >= KNOWN_MAX) continue;
    known.push({ name, stage: status.stage ?? null });
    changed = true;
  }
  return changed ? { ...map, known } : null;
}

/** Whether moving any task can write to Jira. */
export function sendsAnything(map: JiraStatusMap): boolean {
  return COLUMNS.some((c) => map.to[c] !== null);
}

/**
 * Whether a task and its ticket disagree in a way "Send to Jira" would fix:
 * its column sends a status, and the status last read lands elsewhere.
 * A status nothing says anything about is not called a difference.
 */
export function ticketDiffers(
  map: JiraStatusMap,
  column: TaskColumn,
  seen: string | null | undefined,
): boolean {
  const target = map.to[column];
  if (!target || !seen || seen === target) return false;
  const lands = columnOfStatus(map, seen);
  return lands !== null && lands !== column;
}

/** A move Jira offers from where a ticket stands: its id, and the status it leads to. */
export type Transition = { id: string; to: string };

export type MovePlan =
  /** The column sends nothing. */
  | { kind: "off" }
  /** The ticket already stands in a status that lands in this column, and is left there. */
  | { kind: "already"; status: string }
  | { kind: "send"; transition: string; status: string }
  /** Jira offers no move from where the ticket stands to the status this column sends. */
  | { kind: "not-allowed"; from: string; status: string };

/**
 * What moving a task to `column` asks of Jira, given where its ticket stands
 * now and the moves Jira offers from there.
 *
 * A ticket "In Review" whose task was dragged within Doing is not pushed to
 * "In Progress": it already lands in Doing.
 */
export function planMove(
  map: JiraStatusMap,
  column: TaskColumn,
  current: KnownStatus,
  transitions: readonly Transition[],
): MovePlan {
  const target = map.to[column];
  if (!target) return { kind: "off" };
  if (
    current.name === target ||
    columnOfStatus(map, current.name, current.stage) === column
  ) {
    return { kind: "already", status: current.name };
  }
  const lower = target.toLowerCase();
  const move =
    transitions.find((t) => t.to === target) ??
    transitions.find((t) => t.to.toLowerCase() === lower);
  return move
    ? { kind: "send", transition: move.id, status: move.to }
    : { kind: "not-allowed", from: current.name, status: target };
}

/** The statuses in the order the tables show them: Jira's buckets in board order, then as first met. */
export function knownInOrder(map: JiraStatusMap): KnownStatus[] {
  const rank = (s: JiraStage | null) => (s === null ? 3 : COLUMNS.indexOf(s));
  return map.known
    .map((k, i) => ({ k, i }))
    .sort((a, b) => rank(a.k.stage) - rank(b.k.stage) || a.i - b.i)
    .map(({ k }) => k);
}
