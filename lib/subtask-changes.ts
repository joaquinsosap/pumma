// One change to a task's checklist. The panel sends these instead of its whole list, so a stale panel can't overwrite rows it never saw.
import type { Subtask } from "@/lib/schemas";

export const MAX_SUBTASKS = 200;

export type SubtaskChange =
  | { kind: "add"; id: string; title: string }
  | { kind: "setDone"; id: string; done: boolean }
  | { kind: "rename"; id: string; title: string }
  | { kind: "remove"; id: string };

export function sameSubtasks(a: Subtask[], b: Subtask[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (s, i) =>
        s.id === b[i].id && s.title === b[i].title && s.done === b[i].done,
    )
  );
}

/** The list after a change, or null when it doesn't apply. Safe to run twice: the panel's optimistic list replays it on every refresh. */
export function applySubtaskChange(
  list: Subtask[],
  change: SubtaskChange,
): Subtask[] | null {
  const at = list.findIndex((s) => s.id === change.id);
  // The first row with that id only, as Mongo's positional update does.
  const patched = (patch: Partial<Subtask>) =>
    at < 0 ? null : list.map((s, i) => (i === at ? { ...s, ...patch } : s));

  switch (change.kind) {
    case "add":
      if (at >= 0 || list.length >= MAX_SUBTASKS) return null;
      return [...list, { id: change.id, title: change.title, done: false }];
    case "setDone":
      return patched({ done: change.done });
    case "rename":
      return patched({ title: change.title });
    case "remove":
      return list.filter((s) => s.id !== change.id);
  }
}
