"use client";

import { useEffect, useRef } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS as DragCSS } from "@dnd-kit/utilities";
import type { Project, Task } from "@/lib/schemas";
import { projectProgress } from "@/lib/metrics";
import { NewProjectCard } from "@/components/projects/NewProjectCard";
import { ScrollHint } from "@/components/ui/scroll-hint";
import { JiraMark } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { LifeArea } from "@/lib/types";

/**
 * The strip of project cards above the board. Each card is both the switcher
 * for that project and, while a kanban card is in hand, the drop target that
 * moves a task into it.
 *
 * `droppable` is off unless this is rendered inside the board's DndContext,
 * since useDroppable outside one would register nothing and quietly do nothing.
 * `sortable` rides on the same context: a card can then be dragged onto
 * another card to take its place in the rail.
 */
export function ProjectRail({
  projects,
  tasks,
  selectedId,
  onSelect,
  lifeArea,
  droppable = false,
  sortable = false,
  onFromJira,
}: {
  projects: Project[];
  tasks: Task[];
  selectedId?: string;
  onSelect: (id: string) => void;
  lifeArea: LifeArea;
  droppable?: boolean;
  sortable?: boolean;
  /** Opens the sheet that brings tickets in. Left out when no Jira is connected, and then there is no card. */
  onFromJira?: () => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);

  // Keep the selected card on screen. A project created from the end of the
  // rail lands first under "Newest", scrolled out of view, so it read as a card
  // that could not be clicked. Runs again when the list grows, since the new
  // card can arrive after the selection does.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !selectedId) return;
    const card = rail.querySelector<HTMLElement>(
      `[data-project-id="${CSS.escape(selectedId)}"]`,
    );
    if (!card) return;
    const c = card.getBoundingClientRect();
    const r = rail.getBoundingClientRect();
    if (c.left >= r.left && c.right <= r.right) return;
    // Always to the card's start edge: the cards snap by their start, so
    // lining up the right edge would get snapped somewhere else.
    rail.scrollBy({ left: c.left - r.left, behavior: "smooth" });
  }, [selectedId, projects.length]);

  return (
    <div className="relative mb-4">
      <div
        ref={railRef}
        className="flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]"
      >
        {projects.map((p) => (
          <ProjectRailCard
            key={p.id}
            project={p}
            progress={projectProgress(p.id, tasks)}
            active={p.id === selectedId}
            droppable={droppable}
            sortable={droppable && sortable}
            onSelect={() => onSelect(p.id)}
          />
        ))}
        {/* Narrow screens only: a wide one has both doors beside the page's title. */}
        <NewProjectCard
          lifeArea={lifeArea}
          onCreated={(id) => onSelect(id)}
          className="shrink-0 lg:hidden"
        />
        {onFromJira && (
          <FromJiraCard onClick={onFromJira} className="shrink-0 lg:hidden" />
        )}
      </div>
      <ScrollHint targetRef={railRef} direction="right" />
    </div>
  );
}

/** The door to bringing tickets in, drawn like the New project card beside it. */
export function FromJiraCard({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[88px] min-w-[160px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[11px] border border-dashed border-border bg-surface/50 p-[11px_14px] text-faint transition-colors hover:border-faint2 hover:bg-surface hover:text-muted",
        className,
      )}
    >
      <JiraMark className="h-4 w-4 text-jira" />
      <span className="text-[12px] font-semibold">From Jira</span>
    </button>
  );
}

function ProjectRailCard({
  project: p,
  progress: prog,
  active,
  droppable,
  sortable,
  onSelect,
}: {
  project: Project;
  progress: { progress: number; label: string };
  active: boolean;
  droppable: boolean;
  sortable: boolean;
  onSelect: () => void;
}) {
  const {
    setNodeRef: setDropRef,
    isOver: somethingOver,
    active: dragged,
  } = useDroppable({
    id: `project-card:${p.id}`,
    disabled: !droppable,
    data: { type: "project-card", projectId: p.id },
  });
  const {
    setNodeRef: setDragRef,
    listeners,
    transform,
    isDragging,
  } = useDraggable({
    id: `project-drag:${p.id}`,
    disabled: !sortable,
    data: { type: "project-drag", projectId: p.id },
  });
  // Pointer and touch only. The key handler would take Enter and Space away from the button, which is how a keyboard picks a project.
  const { onKeyDown: _keyboardDrag, ...pointerListeners } = listeners ?? {};
  void _keyboardDrag;

  // What is over this card decides what the card says: a task is moving in, another project is taking this place.
  const projectDrag = dragged?.data.current?.type === "project-drag";
  const isOver = somethingOver && !projectDrag;
  const takingPlace =
    somethingOver && projectDrag && dragged?.data.current?.projectId !== p.id;

  // The browser still fires a click on the card a drag ends on; swallow it so letting go never switches project.
  const justDragged = useRef(false);
  useEffect(() => {
    if (isDragging) {
      justDragged.current = true;
      return;
    }
    if (!justDragged.current) return;
    const t = window.setTimeout(() => {
      justDragged.current = false;
    }, 150);
    return () => window.clearTimeout(t);
  }, [isDragging]);

  return (
    <button
      ref={
        droppable
          ? (node) => {
              setDropRef(node);
              setDragRef(node);
            }
          : undefined
      }
      type="button"
      data-project-id={p.id}
      onClick={() => {
        if (!justDragged.current) onSelect();
      }}
      {...(sortable ? pointerListeners : {})}
      className={cn(
        "min-w-[160px] max-w-[240px] shrink-0 snap-start cursor-pointer rounded-[11px] border-[1.5px] p-[11px_14px] text-left transition-all hover:border-faint2",
        active ? "" : "border-border bg-surface",
        // A task is hovering over this card — say so loudly, since the card
        // otherwise looks identical to the one you're dragging away from.
        isOver && "scale-[1.02] border-dashed shadow-[2px_2px_0_var(--shadow)]",
        takingPlace && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        // In the hand: above its neighbours, and following the pointer with no easing.
        isDragging &&
          "relative z-20 cursor-grabbing shadow-[3px_3px_0_var(--shadow)] transition-none",
      )}
      style={{
        ...(active || isOver
          ? {
              borderColor: p.color,
              background: p.color.replace(
                ")",
                isOver ? " / 0.16)" : " / 0.06)",
              ),
            }
          : {}),
        ...(transform ? { transform: DragCSS.Translate.toString(transform) } : {}),
      }}
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
