import { tagCount } from "@/lib/metrics";
import { sortTags, type TagSort } from "@/lib/collection-sort";
import type { Task, Note, Tag } from "@/lib/schemas";
import { TagRailClient } from "./TagRailClient";

type Props = {
  tags: Tag[];
  tasks: Task[];
  notes: Note[];
  /** Chosen in Settings; the rail follows so both lists read the same way. */
  sort?: TagSort;
};

export function TagRail({ tags, tasks, notes, sort = "custom" }: Props) {
  const counts = new Map(
    tags.map((tag) => [tag.id, tagCount(tag.id, tasks, notes)]),
  );
  const items = sortTags(tags, sort, counts).map((tag) => ({
    ...tag,
    count: counts.get(tag.id) ?? 0,
  }));

  return <TagRailClient tags={items} />;
}
