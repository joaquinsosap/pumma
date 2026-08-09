export const TAG_PALETTE = [
  "oklch(0.58 0.17 300)",
  "oklch(0.58 0.14 245)",
  "oklch(0.6 0.13 155)",
  "oklch(0.7 0.12 70)",
  "oklch(0.64 0.18 25)",
  "oklch(0.55 0.16 274)",
] as const;

export type OmniType = "task" | "habit" | "goal" | "note";
export type TaskPriority = "low" | "med" | "high";
export type TaskStatus = "todo" | "doing" | "done";
/** The column a goal sits in. The same two words the rest of the app
 *  uses for a life area — goals used to say "professional" here and nothing
 *  else did, which meant a translation on every read and write. */
export type GoalCategory = "personal" | "work";
export type LifeArea = "personal" | "work";
// Tasks/notes can live in both areas at once (driven by the "work"+"personal"
// tags); every other lifeArea-bearing entity stays 2-valued.
export type EntityLifeArea = LifeArea | "both";
export type LifeView = "personal" | "work" | "both";
export type Theme = "light" | "dark";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; undo?: UndoPayload }
  | { ok: false; error: string };

export type UndoPayload = {
  type: "create" | "delete" | "update";
  entity: "task" | "habit" | "goal" | "note" | "tag";
  snapshot: unknown;
};
