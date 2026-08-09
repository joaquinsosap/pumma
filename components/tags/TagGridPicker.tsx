"use client";

import type { Project, Tag } from "@/lib/schemas";
import { tagBg } from "@/lib/parse";
import { isLifeTag, SPECIAL_LIFE_TAGS } from "@/lib/life-area-sync";
import { cn } from "@/lib/utils";

type Props = {
  tags: Tag[];
  selectedTagIds: string[];
  onToggle: (tagId: string) => void;
  /** Enables the project grouping. Without it this is the flat grid it was. */
  projects?: Project[];
  /** The project the thing being tagged currently sits in. */
  projectId?: string | null;
};

/**
 * Tag picker, grouped the way the model actually works.
 *
 * Life area first, then the tags of the project this task is in, then plain
 * labels, then other projects' tags under a heading that says what picking one
 * does — because picking one moves the task, and that shouldn't be a surprise
 * discovered after the fact.
 */
export function TagGridPicker({
  tags,
  selectedTagIds,
  onToggle,
  projects,
  projectId = null,
}: Props) {
  const selected = new Set(selectedTagIds);

  if (!tags.length) {
    return (
      <p className="m-0 text-[12px] text-faint">
        No tags yet. Add some in Settings.
      </p>
    );
  }

  const grid = (list: Tag[], opts?: { muted?: boolean }) => (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {list.map((tag) => {
        const active = selected.has(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            onClick={() => onToggle(tag.id)}
            title={opts?.muted ? "Moves this task to that project" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left font-mono text-[11px] transition-all",
              active
                ? "border-2 font-bold shadow-[1px_1px_0_var(--shadow)]"
                : "border-border bg-surface2/60 font-medium text-muted hover:border-faint hover:bg-surface2",
              opts?.muted && !active && "border-dashed opacity-70",
            )}
            style={
              active
                ? {
                    color: tag.color,
                    background: tagBg(tag.color),
                    borderColor: tag.color,
                  }
                : undefined
            }
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/5"
              style={{ background: tag.color }}
            />
            <span className="truncate">{tag.name}</span>
          </button>
        );
      })}
    </div>
  );

  const heading = (text: string) => (
    <p className="mb-1.5 mt-3 font-mono text-[9.5px] font-semibold uppercase tracking-widest text-faint2 first:mt-0">
      {text}
    </p>
  );

  const lifeTags = SPECIAL_LIFE_TAGS.map((name) =>
    tags.find((t) => t.name.toLowerCase() === name),
  ).filter((t): t is Tag => Boolean(t));
  const rest = tags.filter((t) => !isLifeTag(t.name));

  if (!projects) {
    return (
      <>
        {lifeTags.length > 0 && (
          <>
            {heading("Life area")}
            {grid(lifeTags)}
          </>
        )}
        {heading("Tags")}
        {grid(rest)}
      </>
    );
  }

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const mine = rest.filter((t) => t.projectId && t.projectId === projectId);
  const plain = rest.filter((t) => !t.projectId);
  const others = rest.filter((t) => t.projectId && t.projectId !== projectId);

  const othersByProject = new Map<string, Tag[]>();
  for (const tag of others) {
    const list = othersByProject.get(tag.projectId!) ?? [];
    list.push(tag);
    othersByProject.set(tag.projectId!, list);
  }

  return (
    <>
      {lifeTags.length > 0 && (
        <>
          {heading("Life area")}
          {grid(lifeTags)}
        </>
      )}

      {projectId && mine.length > 0 && (
        <>
          {heading(projectById.get(projectId)?.title ?? "This project")}
          {grid(mine)}
        </>
      )}

      {plain.length > 0 && (
        <>
          {heading("Labels")}
          {grid(plain)}
        </>
      )}

      {othersByProject.size > 0 && (
        <>
          {heading(
            projectId ? "Move to another project" : "File under a project",
          )}
          {[...othersByProject.entries()].map(([id, list]) => (
            <div key={id} className="mb-1.5">
              <p className="mb-1 font-mono text-[9px] text-faint2">
                {projectById.get(id)?.title ?? "Project"}
              </p>
              {grid(list, { muted: true })}
            </div>
          ))}
        </>
      )}
    </>
  );
}
