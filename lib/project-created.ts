// What to say when a project has just been made, wherever it was made from.

/** The part of a new project's result the line is built from. */
export type CreatedProjectFacts = {
  project: { title: string };
  /** Set when the project took over a tag that already existed, with how many unfiled tasks moved in. */
  adopted: { tagName: string; filed: number } | null;
};

/** Longest name a project takes. The same limit the server holds. */
export const PROJECT_TITLE_MAX = 120;

/**
 * "Created ...", saying so when the project took over an existing tag: that
 * moves tasks, and quietly re-filing somebody's work is not a nice surprise.
 */
export function projectCreatedLine({ project, adopted }: CreatedProjectFacts): string {
  if (!adopted) return `Created "${project.title}"`;
  const moved = adopted.filed
    ? `, ${adopted.filed} unfiled task${adopted.filed === 1 ? "" : "s"} moved in`
    : "";
  return `Created "${project.title}", #${adopted.tagName} files here now${moved}`;
}
