import { noteHref } from "@/lib/note-href";

/** Everything with a page a link can land on, with it open. */
export type LinkableEntity =
  | "task"
  | "project"
  | "goal"
  | "habit"
  | "note"
  | "meeting";

const ENTITY_HREF: Record<LinkableEntity, (id: string) => string> = {
  task: (id) => `/tasks?task=${id}`,
  project: (id) => `/projects?project=${id}`,
  goal: (id) => `/goals?goal=${id}`,
  habit: (id) => `/habits?habit=${id}`,
  note: (id) => noteHref(id),
  // A meeting has no page of its own; the calendar is where it lives, and the
  // day it is on is the useful place to land.
  meeting: () => `/calendar`,
};

export function entityHref(entity: LinkableEntity, id: string): string {
  return ENTITY_HREF[entity](id);
}
