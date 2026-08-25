"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { Project, Task } from "@/lib/schemas";
import { projectProgress } from "@/lib/metrics";
import { NewProjectCard } from "@/components/projects/NewProjectCard";
import { ScrollHint } from "@/components/ui/scroll-hint";
import { cn } from "@/lib/utils";
import type { LifeArea } from "@/lib/types";

/**
 * The strip of project cards above the board. Each card is both the switcher
 * for that project and, while a kanban card is in hand, the drop target that
 * moves a task into it.
 *
 * `droppable` is off unless this is rendered inside the board's DndContext —
 * useDroppable outside one would register nothing and quietly do nothing.
 */
export function ProjectRail({
  projects,
  tasks,
  selectedId,
  onSelect,
  lifeArea,
  droppable = false,
  sortControl,
  sortVisible = false,
  onSortVisibleChange,
}: {
  projects: Project[];
  tasks: Task[];
  selectedId?: string;
  onSelect: (id: string) => void;
  lifeArea: LifeArea;
  droppable?: boolean;
  /** The rail's sort menu, rendered as a slim leading chip in the strip. */
  sortControl?: React.ReactNode;
  /** Whether the rail should rest on the sort control. Persisted. */
  sortVisible?: boolean;
  onSortVisibleChange?: (visible: boolean) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);

  /**
   * The sort control is the rail's first snap position, so the rail can rest
   * either on it or on the first project. Which one it rests on is a
   * preference, not a scroll accident:
   *
   * - Hidden by default. The control costs a quarter of the rail on a phone
   *   and most visits are about the projects.
   * - Scrolling left onto it reveals it, and it STAYS: snap-start means the
   *   rail settles there instead of springing back, which is the whole
   *   reason this works at all.
   * - Scrolling right past it, or picking a different project, hides it.
   * - Whichever way it ends up is remembered for next time.
   */
  const railStart = () =>
    (railRef.current?.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0;

  // Place the rail before first paint, so it never shows the control and
  // then jumps.
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail || sortVisible) return;
    const control = rail.firstElementChild as HTMLElement | null;
    if (!control) return;
    rail.scrollLeft = control.offsetWidth + 8;
    // Once only: after this the user's scrolling owns the position.
  }, [sortVisible]);

  // Remember where it settled. Debounced, because a scroll fires a lot and
  // this is a preference, not a cursor.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !onSortVisibleChange) return;
    let timer: number | undefined;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const revealed = rail.scrollLeft < railStart() / 2;
        if (revealed !== sortVisible) onSortVisibleChange(revealed);
      }, 200);
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      rail.removeEventListener("scroll", onScroll);
    };
  }, [sortVisible, onSortVisibleChange]);

  // A new selection is a decision about projects, so the control gets out of
  // the way. Comparing against a previous prop does not work here: picking a
  // project swaps the whole rail for the board's own instance, so the change
  // is a MOUNT with a selection, never a prop transition. Having a selection
  // at all is therefore the condition.
  useEffect(() => {
    if (!selectedId || !sortVisible) return;
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollTo({ left: railStart(), behavior: "smooth" });
    onSortVisibleChange?.(false);
  }, [selectedId, sortVisible, onSortVisibleChange]);

  return (
    <div className="relative mb-4">
      <div
        ref={railRef}
        className="flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]"
      >
        {/* snap-start, or scroll-snap treats this as a gap to be crossed and
            always pulls to the first card: the control could only ever be
            glimpsed during a rubber-band overscroll, and snapped away the
            moment you let go. As a snap position it is somewhere the rail can
            actually rest, so scrolling left reveals it and it stays until you
            scroll right. That is the behaviour Joaquin found by accident and
            wanted kept. */}
        {sortControl ? (
          <div className="flex shrink-0 snap-start items-center">
            {sortControl}
          </div>
        ) : null}
        {projects.map((p) => (
          <ProjectRailCard
            key={p.id}
            project={p}
            progress={projectProgress(p.id, tasks)}
            active={p.id === selectedId}
            droppable={droppable}
            onSelect={() => onSelect(p.id)}
          />
        ))}
        <NewProjectCard
          lifeArea={lifeArea}
          onCreated={(id) => onSelect(id)}
          className="shrink-0"
        />
      </div>
      <ScrollHint targetRef={railRef} direction="right" />
    </div>
  );
}

function ProjectRailCard({
  project: p,
  progress: prog,
  active,
  droppable,
  onSelect,
}: {
  project: Project;
  progress: { progress: number; label: string };
  active: boolean;
  droppable: boolean;
  onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `project-card:${p.id}`,
    disabled: !droppable,
    data: { type: "project-card", projectId: p.id },
  });

  return (
    <button
      ref={droppable ? setNodeRef : undefined}
      type="button"
      onClick={onSelect}
      className={cn(
        "min-w-[160px] max-w-[240px] shrink-0 snap-start cursor-pointer rounded-[11px] border-[1.5px] p-[11px_14px] text-left transition-all hover:border-faint2",
        active ? "" : "border-border bg-surface",
        // A task is hovering over this card — say so loudly, since the card
        // otherwise looks identical to the one you're dragging away from.
        isOver && "scale-[1.02] border-dashed shadow-[2px_2px_0_var(--shadow)]",
      )}
      style={
        active || isOver
          ? {
              borderColor: p.color,
              background: p.color.replace(
                ")",
                isOver ? " / 0.16)" : " / 0.06)",
              ),
            }
          : undefined
      }
    >
      <div className="mb-2 flex items-center gap-1.5 text-[13.5px] font-bold">
        <span
          className="h-[9px] w-[9px] shrink-0 rounded-[2px]"
          style={{ background: p.color }}
        />
        <span className="min-w-0 truncate">{p.title}</span>
      </div>
      <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-border2">
        <div
          className="h-full transition-[width] duration-300"
          style={{ width: `${prog.progress}%`, background: p.color }}
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-faint">
        <span>{isOver ? "drop to move here" : prog.label}</span>
        <span>{prog.progress}%</span>
      </div>
    </button>
  );
}
