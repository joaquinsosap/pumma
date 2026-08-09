"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "@/components/icons";
import type { Note, Tag, Task } from "@/lib/schemas";
import { tagsByUsage } from "@/lib/metrics";
import { tagBg } from "@/lib/parse";
import { cn } from "@/lib/utils";

type PickProps = {
  tags: Tag[];
  tasks: Task[];
  notes: Note[];
  selectedTagIds: string[];
  onToggle: (tagId: string) => void;
  showLabel?: boolean;
  className?: string;
};

function useHorizontalScrollState(deps: unknown[]) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({
      left: el.scrollLeft > 2,
      right: max > 2 && el.scrollLeft < max - 2,
    });
  }, []);

  useEffect(() => {
    update();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update, ...deps]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;

      const max = el.scrollWidth - el.clientWidth;
      const next = el.scrollLeft + e.deltaY;
      const clamped = Math.max(0, Math.min(max, next));
      if (clamped === el.scrollLeft) return;

      e.preventDefault();
      el.scrollLeft = clamped;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [...deps]);

  return { scrollRef, edges, update };
}

export function TagQuickPick({
  tags,
  tasks,
  notes,
  selectedTagIds,
  onToggle,
  showLabel = true,
  className,
}: PickProps) {
  const ranked = useMemo(
    () => tagsByUsage(tags, tasks, notes),
    [tags, tasks, notes],
  );

  const selected = useMemo(() => new Set(selectedTagIds), [selectedTagIds]);

  const { scrollRef, edges } = useHorizontalScrollState([ranked]);

  if (!ranked.length) return null;

  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-1.5", className)}>
      {showLabel && (
        <span className="shrink-0 font-mono text-[10px] tracking-wide text-faint2">
          TAGS →
        </span>
      )}
      <div className="relative min-w-0 flex-1">
        {edges.left && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-[1] flex w-7 items-center justify-start bg-gradient-to-r from-surface from-40% via-surface/95 to-transparent pl-0.5"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-surface2 shadow-[0_0_0_1px_var(--border)]">
              <ChevronLeft
                className="h-3.5 w-3.5 text-muted omni-scroll-hint-left"
                strokeWidth={2.5}
              />
            </span>
          </div>
        )}
        {edges.right && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-[1] flex w-7 items-center justify-end bg-gradient-to-l from-surface from-40% via-surface/95 to-transparent pr-0.5"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-surface2 shadow-[0_0_0_1px_var(--border)]">
              <ChevronRight
                className="h-3.5 w-3.5 text-muted omni-scroll-hint-right"
                strokeWidth={2.5}
              />
            </span>
          </div>
        )}
        <div
          ref={scrollRef}
          className="min-w-0 overflow-x-auto px-px [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex w-max items-center gap-1.5 pr-1">
            {ranked.map((tag) => {
              const active = selected.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => onToggle(tag.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-lg px-2 py-0.5 font-mono text-[10px] transition-all",
                    active
                      ? "border-2 font-bold shadow-[2px_2px_0_var(--shadow)]"
                      : "border border-border bg-surface font-medium text-muted opacity-75 hover:border-faint hover:bg-surface2 hover:opacity-100",
                  )}
                  style={
                    active
                      ? {
                          color: tag.color,
                          background: tagBg(tag.color),
                          borderColor: tag.color,
                          boxShadow: `2px 2px 0 ${tag.color.replace(")", " / 0.4)")}`,
                        }
                      : undefined
                  }
                  title={
                    tag.count
                      ? `${tag.count} uses · ${active ? "remove" : "add"}`
                      : active
                        ? "Remove tag"
                        : "Add tag"
                  }
                >
                  <span
                    className="h-2 w-2 rounded-full ring-1 ring-black/5"
                    style={{ background: tag.color }}
                  />
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SelectedTagsTray({
  tags,
  selectedTagIds,
  allTags,
  onRemove,
}: {
  tags?: Tag[];
  selectedTagIds: string[];
  allTags: Tag[];
  onRemove: (tagId: string) => void;
}) {
  const selectedTags =
    tags ??
    (selectedTagIds
      .map((id) => allTags.find((t) => t.id === id))
      .filter(Boolean) as Tag[]);

  if (!selectedTags.length) return null;

  return (
    <div
      className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-surface2 px-2.5 py-1"
      style={{ boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.04)" }}
    >
      <span className="font-mono text-[9px] font-medium uppercase tracking-widest text-faint2">
        using
      </span>
      <div className="flex items-center gap-1">
        {selectedTags.map((tag) => (
          <span
            key={tag.id}
            className="group flex items-center gap-1 rounded-md py-0.5 pl-1.5 pr-1 font-mono text-[10px] font-medium"
            style={{
              color: tag.color,
              background: tagBg(tag.color),
              boxShadow: `inset 0 0 0 1px ${tag.color.replace(")", " / 0.35)")}`,
            }}
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: tag.color }}
            />
            {tag.name}
            <button
              type="button"
              onClick={() => onRemove(tag.id)}
              className="ml-0.5 flex h-4 w-4 items-center justify-center rounded opacity-60 transition-opacity hover:bg-black/5 hover:opacity-100"
              aria-label={`Remove ${tag.name}`}
            >
              <X className="h-2.5 w-2.5" strokeWidth={2.5} />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
