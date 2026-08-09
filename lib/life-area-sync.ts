// Pure, no server-only import — unit-testable. Shared by every place that
// mutates tagIds so the "work"/"personal" tags and lifeArea never drift apart.
import type {
  EntityLifeArea,
  GoalCategory,
  LifeArea,
  LifeView,
} from "@/lib/types";

export const SPECIAL_LIFE_TAGS = ["work", "personal"] as const;

/** Colours match the sidebar's Personal/Work toggle. */
export const LIFE_TAG_COLORS: Record<
  (typeof SPECIAL_LIFE_TAGS)[number],
  string
> = {
  work: "oklch(0.58 0.14 245)",
  personal: "oklch(0.55 0.16 274)",
};

/**
 * Tags named "work" or "personal" are the life area itself — not ordinary
 * labels. They can't be deleted, and every taggable thing carries at least one.
 */
export function isLifeTag(name: string): boolean {
  return (SPECIAL_LIFE_TAGS as readonly string[]).includes(
    name.trim().toLowerCase()
  );
}

/**
 * Which life tags a new item gets, given the view it was created in. Capturing
 * in Both means it genuinely belongs to both, so it gets both tags rather than
 * a third state stored somewhere else.
 */
export function lifeTagNamesForView(view: LifeView): string[] {
  if (view === "work") return ["work"];
  if (view === "personal") return ["personal"];
  return ["personal", "work"];
}

/**
 * Derive an item's lifeArea from its tags — the tags are the only input.
 *
 * Nothing should ever reach here untagged: every create path attaches the tags
 * for the view it ran in. "personal" is the fallback for the case that
 * shouldn't happen, because vanishing from every view is a far worse failure
 * than showing up in the wrong one.
 */
export function deriveLifeAreaFromTags(
  tagIds: string[],
  tags: { id: string; name: string }[]
): EntityLifeArea {
  const nameById = new Map(tags.map((t) => [t.id, t.name.toLowerCase()]));
  const names = new Set(
    tagIds.map((id) => nameById.get(id)).filter((n): n is string => Boolean(n))
  );
  const hasWork = names.has("work");
  const hasPersonal = names.has("personal");
  if (hasWork && hasPersonal) return "both";
  if (hasWork) return "work";
  return "personal";
}

/**
 * Same rule for entities whose lifeArea has no "both" state. They still carry
 * both tags when they belong to both; "personal" is simply the side they file
 * under.
 */
export function deriveStrictLifeAreaFromTags(
  tagIds: string[],
  tags: { id: string; name: string }[]
): LifeArea {
  return deriveLifeAreaFromTags(tagIds, tags) === "work" ? "work" : "personal";
}

/**
 * Add the life tags for `view` to a tag list. Used on create so nothing is ever
 * stored without one. An explicit life tag already in the list wins over the
 * view — typing "#work" while in Personal means work.
 */
export function withLifeTags(
  tagIds: string[],
  view: LifeView,
  tags: { id: string; name: string }[]
): string[] {
  const nameById = new Map(tags.map((t) => [t.id, t.name.toLowerCase()]));
  const present = new Set(tagIds.map((id) => nameById.get(id)));
  if (present.has("work") || present.has("personal")) return [...tagIds];

  const idsByName = new Map(tags.map((t) => [t.name.toLowerCase(), t.id]));
  const next = [...tagIds];
  for (const name of lifeTagNamesForView(view)) {
    const id = idsByName.get(name);
    if (id && !next.includes(id)) next.push(id);
  }
  return next;
}

/** Whether a tag list carries at least one life tag. */
export function hasLifeTag(
  tagIds: string[],
  tags: { id: string; name: string }[]
): boolean {
  const nameById = new Map(tags.map((t) => [t.id, t.name.toLowerCase()]));
  return tagIds.some((id) => {
    const name = nameById.get(id);
    return name === "work" || name === "personal";
  });
}

/**
 * Set an item's life tags to exactly those of `view`, dropping the others.
 *
 * This is what a *move* means: dragging a personal goal into the Work column,
 * or a task into a work project, makes it work — adding "work" while leaving
 * "personal" on would land it in both, which isn't what moving means. Only
 * capturing in the Both view legitimately produces two.
 */
export function setLifeTags(
  tagIds: string[],
  view: LifeView,
  tags: { id: string; name: string }[]
): string[] {
  const nameById = new Map(tags.map((t) => [t.id, t.name.toLowerCase()]));
  const idsByName = new Map(tags.map((t) => [t.name.toLowerCase(), t.id]));
  const wanted = lifeTagNamesForView(view)
    .map((name) => idsByName.get(name))
    .filter((id): id is string => Boolean(id));
  // Nothing to put back means the life tags are missing from the account —
  // leave what's there rather than stripping the item out of every view.
  if (!wanted.length) return tagIds;
  const withoutLife = tagIds.filter((id) => {
    const name = nameById.get(id);
    return name !== "work" && name !== "personal";
  });
  return [...withoutLife, ...wanted];
}

/** Replace an item's life tags with those of the project it just moved into. */
export function withProjectLifeTags(
  tagIds: string[],
  projectLifeArea: EntityLifeArea | null | undefined,
  tags: { id: string; name: string }[]
): string[] {
  if (!projectLifeArea) return tagIds;
  return setLifeTags(tagIds, projectLifeArea, tags);
}

/**
 * Goals sit in a Personal or Work column. That column is the life tag under
 * the same word now, so the only thing left to decide is where a goal tagged
 * "both" lives: on the personal side, while still showing in every view.
 */
export function goalCategoryForLifeArea(area: EntityLifeArea): GoalCategory {
  return area === "work" ? "work" : "personal";
}
