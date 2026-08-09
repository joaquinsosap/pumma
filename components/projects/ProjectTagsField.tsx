"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Star } from "@/components/icons";
import { toast } from "sonner";
import type { Project, Tag } from "@/lib/schemas";
import {
  attachTagToProjectAction,
  detachTagFromProjectAction,
} from "@/lib/actions/projects";
import { renameProjectTagAction } from "@/lib/actions/tags";
import { tagsForProject } from "@/lib/project-tags";
import { isLifeTag } from "@/lib/life-area-sync";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";

/**
 * The tags that file things into this project.
 *
 * The flagship is starred and can't be removed — a project always keeps one —
 * but it can be renamed, which is the whole point of a tag you'll be typing
 * for the rest of the project's life.
 */
export function ProjectTagsField({
  project,
  tags,
}: {
  project: Project;
  tags: Tag[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const mine = tagsForProject(tags, project.id);
  // Only unclaimed, non-life tags can join — a tag files into one project.
  const available = tags.filter((t) => !t.projectId && !isLifeTag(t.name));

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error ?? "Something went wrong");
        return;
      }
      router.refresh();
    });

  const commitRename = (tag: Tag) => {
    const next = draft.trim().toLowerCase();
    setRenaming(null);
    if (!next || next === tag.name) return;

    startTransition(async () => {
      const res = await renameProjectTagAction({ id: tag.id, name: next });
      if (!res.ok) {
        toast.error(res.error ?? "Could not rename");
        return;
      }
      if (!res.data) return;
      if (res.data.status === "renamed") {
        router.refresh();
        return;
      }

      // The name is taken by an ordinary tag, so this rename absorbs it and
      // moves work around. Say exactly how much before doing it.
      const { tagName, willFile, willUnlabel } = res.data;
      const parts = [
        willFile
          ? `${willFile} unfiled task${willFile === 1 ? "" : "s"} tagged #${tagName} will move into ${project.title}.`
          : `Nothing is unfiled under #${tagName}, so no task moves.`,
      ];
      if (willUnlabel) {
        parts.push(
          `${willUnlabel} task${willUnlabel === 1 ? "" : "s"} already in other projects will stay put and lose the #${tagName} label.`
        );
      }

      const ok = await confirm({
        title: `Rename to #${tagName}?`,
        description: parts.join(" "),
        confirmLabel: "Rename and merge",
      });
      if (!ok) return;

      const merged = await renameProjectTagAction({
        id: tag.id,
        name: next,
        confirmMerge: true,
      });
      if (!merged.ok) {
        toast.error(merged.error ?? "Could not rename");
        return;
      }
      if (merged.data?.status === "renamed" && merged.data.filed) {
        toast.success(
          `#${next} files here now — ${merged.data.filed} task${merged.data.filed === 1 ? "" : "s"} moved in`
        );
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {mine.map((tag) =>
          renaming === tag.id ? (
            <input
              key={tag.id}
              autoFocus
              value={draft}
              disabled={pending}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitRename(tag)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(null);
              }}
              className="w-[140px] rounded-lg border border-border bg-surface px-2 py-1 font-mono text-[11px] text-ink outline-none focus:border-faint"
            />
          ) : (
            <span
              key={tag.id}
              className="group flex items-center gap-1 rounded-lg border px-2 py-1 font-mono text-[11px]"
              style={{
                borderColor: tag.color,
                background: tag.color.replace(")", " / 0.10)"),
                color: tag.color,
              }}
            >
              {tag.isProjectPrimary && (
                <Star className="h-2.5 w-2.5 shrink-0 fill-current" />
              )}
              <button
                type="button"
                disabled={pending}
                title="Rename"
                onClick={() => {
                  setRenaming(tag.id);
                  setDraft(tag.name);
                }}
                className="truncate disabled:opacity-50"
              >
                {tag.name}
              </button>
              {!tag.isProjectPrimary && (
                <button
                  type="button"
                  disabled={pending}
                  title="Release this tag — it stops filing into this project"
                  aria-label={`Remove ${tag.name} from project`}
                  onClick={() => run(() => detachTagFromProjectAction(tag.id))}
                  className="opacity-60 transition-opacity hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          )
        )}

        {adding ? (
          <select
            autoFocus
            disabled={pending}
            defaultValue=""
            onBlur={() => setAdding(false)}
            onChange={(e) => {
              const tagId = e.target.value;
              setAdding(false);
              if (!tagId) return;
              startTransition(async () => {
                const res = await attachTagToProjectAction({
                  projectId: project.id,
                  tagId,
                });
                if (!res.ok) {
                  toast.error(res.error ?? "Could not add tag");
                  return;
                }
                const filed = res.data?.filed ?? 0;
                if (filed) {
                  toast.success(
                    `${filed} unfiled task${filed === 1 ? "" : "s"} moved into ${project.title}`
                  );
                }
                router.refresh();
              });
            }}
            className="rounded-lg border border-border bg-surface px-2 py-1 font-mono text-[11px] text-ink outline-none focus:border-faint"
          >
            <option value="">Pick a tag…</option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            disabled={pending || !available.length}
            onClick={() => setAdding(true)}
            title={
              available.length
                ? "Add an existing tag to this project"
                : "Every tag already belongs to a project"
            }
            className={cn(
              "flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-faint hover:text-ink",
              "disabled:opacity-40"
            )}
          >
            <Plus className="h-3 w-3" />
            Tag
          </button>
        )}
      </div>
      <p className="m-0 text-[11px] leading-relaxed text-faint">
        Tagging a task with one of these files it here. Click a tag to rename
        it; the starred one is the project&apos;s own and stays.
      </p>
    </div>
  );
}
