"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "@/components/icons";
import { toast } from "sonner";
import type { Tag } from "@/lib/schemas";
import { toggleEntityTag, type TaggableEntity } from "@/lib/actions/tags";
import { tagBg } from "@/lib/parse";
import { isLifeTag, SPECIAL_LIFE_TAGS } from "@/lib/life-area-sync";
import { cn } from "@/lib/utils";

type Props = {
  entity: TaggableEntity;
  entityId: string;
  tags: Tag[];
  selectedTagIds: string[];
};

/**
 * Tags for the things that aren't tasks — habits, goals, projects.
 *
 * The life tags come first and are always shown, selected or not: they're what
 * the personal/work split reads, so which one is on has to be visible without
 * opening anything. Ordinary labels sit behind a "+".
 */
export function EntityTagRow({ entity, entityId, tags, selectedTagIds }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(selectedTagIds);
  const [picking, setPicking] = useState(false);

  const on = new Set(selected);
  const lifeTags = SPECIAL_LIFE_TAGS.map((name) =>
    tags.find((t) => t.name.toLowerCase() === name)
  ).filter((t): t is Tag => Boolean(t));
  const labels = tags.filter((t) => !isLifeTag(t.name) && !t.projectId);
  const chosenLabels = labels.filter((t) => on.has(t.id));

  const toggle = (tagId: string) => {
    startTransition(async () => {
      const res = await toggleEntityTag(entity, entityId, tagId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data) {
        setSelected((prev) =>
          res.data!.applied
            ? [...prev, tagId]
            : prev.filter((id) => id !== tagId)
        );
      }
      // A life tag can move a goal to the other column and drag a project's
      // tasks with it, so the server's version is the one to believe.
      router.refresh();
    });
  };

  const chip = (tag: Tag, active: boolean) => (
    <button
      key={tag.id}
      type="button"
      disabled={pending}
      onClick={() => toggle(tag.id)}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px] transition-all disabled:opacity-60",
        active
          ? "border-2 font-bold shadow-[1px_1px_0_var(--shadow)]"
          : "border-border bg-surface2/60 font-medium text-muted hover:border-faint hover:bg-surface2"
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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {lifeTags.map((tag) => chip(tag, on.has(tag.id)))}
        {chosenLabels.map((tag) => chip(tag, true))}
        {labels.length > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setPicking((v) => !v)}
            aria-expanded={picking}
            className={cn(
              "flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-faint hover:text-ink disabled:opacity-40",
              picking && "border-faint text-ink"
            )}
          >
            <Plus className="h-3 w-3" />
            Label
          </button>
        )}
      </div>

      {picking && (
        <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-border bg-surface2/40 p-2 sm:grid-cols-3">
          {labels.map((tag) => chip(tag, on.has(tag.id)))}
        </div>
      )}
    </div>
  );
}
