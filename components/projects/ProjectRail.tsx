"use client";

import { useRef } from "react";
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
}: {
  projects: Project[];
  tasks: Task[];
  selectedId?: string;
  onSelect: (id: string) => void;
  lifeArea: LifeArea;
  droppable?: boolean;
}) {
  const railRef = useRef<HTMLDivElement>(null);

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
