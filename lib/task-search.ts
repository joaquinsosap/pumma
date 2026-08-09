import type { Task, Tag, Project } from "@/lib/schemas";

/**
 * Lowercase and strip accents, so "cafe" finds "Café" and vice versa.
 */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Split a raw query into terms. Terms are ANDed, so "buy milk" matches a task
 * containing both words in any order — which is how people actually half-
 * remember the thing they're looking for.
 */
export function searchTerms(query: string): string[] {
  return normalizeSearch(query).split(/\s+/).filter(Boolean);
}

/**
 * Filter tasks by a free-text query, matching title, description, subtask
 * titles, tag names and project title.
 *
 * A term written as `#foo` is matched against tag names only — the same `#tag`
 * idiom the capture bar uses, so it means the same thing in both places.
 */
export function searchTasks(
  tasks: Task[],
  query: string,
  ctx: { tags: Tag[]; projects: Project[] },
): Task[] {
  const terms = searchTerms(query);
  if (!terms.length) return tasks;

  const tagNames = new Map(
    ctx.tags.map((t) => [t.id, normalizeSearch(t.name)]),
  );
  const projectTitles = new Map(
    ctx.projects.map((p) => [p.id, normalizeSearch(p.title)]),
  );

  return tasks.filter((task) => {
    const tagText = task.tagIds.map((id) => tagNames.get(id) ?? "").join(" ");
    const haystack = [
      tagText,
      normalizeSearch(task.title),
      normalizeSearch(task.description),
      task.subtasks.map((s) => normalizeSearch(s.title)).join(" "),
      task.projectId ? (projectTitles.get(task.projectId) ?? "") : "",
    ].join(" ");

    return terms.every((term) => {
      // A bare "#" is someone mid-type; treat it as an ordinary term rather
      // than an empty tag match that hits everything.
      if (term.startsWith("#") && term.length > 1) {
        return tagText.includes(term.slice(1));
      }
      return haystack.includes(term);
    });
  });
}
