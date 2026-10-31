// Pure rules for writing a task's subtasks through the MCP.
import { oid } from "@/lib/date";
import type { Subtask } from "@/lib/schemas";

export type SubtaskInput = { title: string; done?: boolean };

/** How two titles count as one subtask: "Water ", "water" and "Water" are the same row. */
function titleKey(title: string): string {
  return title.normalize("NFC").trim().toLowerCase();
}

/** The list a call asks for: a title already on the task keeps its id and, unless told otherwise, its tick. */
export function subtasksFromInput(
  input: SubtaskInput[],
  existing: Subtask[],
  makeId: () => string = oid,
): Subtask[] {
  const unclaimed = [...existing];
  const claim = (matches: (s: Subtask) => boolean) => {
    const at = unclaimed.findIndex(matches);
    return at >= 0 ? unclaimed.splice(at, 1)[0] : undefined;
  };

  // Exact titles claim first, so a near match can't take a row another item names exactly.
  const matched = input.map(({ title }) => claim((s) => s.title === title));
  input.forEach(({ title }, i) => {
    matched[i] ??= claim((s) => titleKey(s.title) === titleKey(title));
  });

  return input.map(({ title, done }, i) => ({
    id: matched[i]?.id ?? makeId(),
    title,
    done: done ?? matched[i]?.done ?? false,
  }));
}

/** Every box ticked, for a task that just closed. */
export function tickedSubtasks(subtasks: Subtask[]): Subtask[] {
  return subtasks.map((s) => ({ ...s, done: true }));
}

export function sameSubtasks(a: Subtask[], b: Subtask[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (s, i) =>
        s.id === b[i].id && s.title === b[i].title && s.done === b[i].done,
    )
  );
}

/** Rows a new list adds and drops, by id. */
export function subtaskChanges(
  before: Subtask[],
  after: Subtask[],
): { added: number; removed: number } {
  const had = new Set(before.map((s) => s.id));
  const added = after.filter((s) => !had.has(s.id)).length;
  // Counted, not looked up, so two rows sharing an id can't hide a dropped one.
  return { added, removed: before.length - (after.length - added) };
}
