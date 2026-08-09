// Pure rules for the tag <-> project link. No server-only import, so the
// invariants can be unit-tested without a database.

/** The shape both backends and the UI share for this. */
export type ProjectTagLike = {
  id: string;
  name: string;
  projectId?: string | null;
  isProjectPrimary?: boolean;
};

/** A tag that files whatever carries it under a project. */
export function isProjectTag(tag: ProjectTagLike): boolean {
  return Boolean(tag.projectId);
}

/**
 * The flagship tag for a project: its name, lowercased, spaces as dashes.
 * "Game Dev Ops" -> "game-dev-ops".
 *
 * Readable beats short here — the tag is how you'll refer to the project for
 * the rest of its life, and autocomplete means you only type a few characters
 * of it anyway.
 */
export function projectTagSlug(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .join("-");
  // A title of pure punctuation would otherwise produce an unusable empty tag.
  return slug.slice(0, 40) || "project";
}

/**
 * Pick a name not already taken, by appending a number. Compared
 * case-insensitively because tag names are matched that way everywhere.
 */
export function uniqueTagName(base: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}${i}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Which project a set of tags files something under.
 *
 * A task belongs to exactly one project, so carrying two project tags is not a
 * state worth representing — the newest one wins, which is what "I just typed
 * #ai" should mean. Returns null when no project tag is present, leaving the
 * caller to decide whether that clears the link.
 */
export function projectIdFromTags(
  tagIds: string[],
  tags: ProjectTagLike[],
): string | null {
  const byId = new Map(tags.map((t) => [t.id, t]));
  let found: string | null = null;
  for (const id of tagIds) {
    const projectId = byId.get(id)?.projectId;
    if (projectId) found = projectId;
  }
  return found;
}

/**
 * Drop every project tag except the one being kept, so a task never carries
 * two. Ordinary tags are untouched — those are shareable.
 */
export function withSingleProjectTag(
  tagIds: string[],
  keepProjectId: string | null,
  tags: ProjectTagLike[],
): string[] {
  const byId = new Map(tags.map((t) => [t.id, t]));
  return tagIds.filter((id) => {
    const tag = byId.get(id);
    if (!tag?.projectId) return true;
    return tag.projectId === keepProjectId;
  });
}

/**
 * Make sure a task filed under a project also *says* so.
 *
 * `withSingleProjectTag` only removes other projects' tags; it never adds
 * the one the task is being filed under. That is the right split when the
 * project came from a tag in the text — the tag is already there — but not
 * when it came from the view you were looking at. Capturing inside a project
 * used to set `projectId` and leave the task with no project tag at all,
 * which made it invisible to every tag-based filter.
 *
 * Flagship tag only: a project can own several tags, and inheriting all of
 * them would put words on the task nobody typed.
 */
export function withProjectPrimaryTag(
  tagIds: string[],
  projectId: string | null,
  tags: ProjectTagLike[],
): string[] {
  if (!projectId) return tagIds;
  const primary =
    tags.find((t) => t.projectId === projectId && t.isProjectPrimary) ??
    tags.find((t) => t.projectId === projectId);
  if (!primary || tagIds.includes(primary.id)) return tagIds;
  return [...tagIds, primary.id];
}

/** Every tag currently attached to a project, flagship first. */
export function tagsForProject<T extends ProjectTagLike>(
  tags: T[],
  projectId: string,
): T[] {
  return tags
    .filter((t) => t.projectId === projectId)
    .sort((a, b) => Number(b.isProjectPrimary) - Number(a.isProjectPrimary));
}

/**
 * Split a capture's tags into one bucket per project.
 *
 * Tags from two projects mean two pieces of work owned by two projects, so the
 * capture becomes one task each rather than picking a winner. Every bucket
 * keeps the tags that belong to no project — life tags and ordinary labels
 * aren't about projects, so they ride along on all of them.
 *
 * No project tags at all gives a single bucket with a null project: untagged
 * means unfiled.
 */
export function splitTagsByProject(
  tagIds: string[],
  tags: ProjectTagLike[],
): { projectId: string | null; tagIds: string[] }[] {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const shared: string[] = [];
  // Insertion-ordered, so the first project you typed is the first task made.
  const byProject = new Map<string, string[]>();

  for (const id of tagIds) {
    const projectId = byId.get(id)?.projectId;
    if (!projectId) {
      shared.push(id);
      continue;
    }
    const bucket = byProject.get(projectId);
    if (bucket) bucket.push(id);
    else byProject.set(projectId, [id]);
  }

  if (!byProject.size) return [{ projectId: null, tagIds: shared }];
  return [...byProject.entries()].map(([projectId, own]) => ({
    projectId,
    tagIds: [...shared, ...own],
  }));
}
