"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Pencil } from "@/components/icons";
import { useQueryState } from "nuqs";
import type { Goal, Project, Task, Tag } from "@/lib/schemas";
import { projectProgress } from "@/lib/metrics";
import { parseLifeView } from "@/lib/life-area";
import { Topbar } from "@/components/shell/Topbar";
import { KanbanBoard, boardOrder } from "@/components/projects/KanbanBoard";
import { ProjectDetailPanel } from "@/components/projects/ProjectDetailPanel";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";
import { BulkEditPanel } from "@/components/tasks/BulkEditPanel";
import { SelectionBar } from "@/components/tasks/SelectionBar";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { NewProjectCard } from "@/components/projects/NewProjectCard";
import { ProjectRail } from "@/components/projects/ProjectRail";
import { setTaskProject } from "@/lib/actions/tasks";
import { toast } from "sonner";
import { useIsDesktop } from "@/lib/use-media-query";
import { useTaskSelection } from "@/lib/use-task-selection";
import { lifeAreaForCreate } from "@/lib/life-area";

type Props = {
  projects: Project[];
  tasks: Task[];
  tags: Tag[];
  goals: Goal[];
  stats: { dayPct: number; habitsLabel: string; topStreak: number };
  birthDate?: string | null;
  lifeSpanYears?: number;
};

export function ProjectsView({
  projects,
  tasks,
  tags,
  goals,
  stats,
  birthDate = null,
  lifeSpanYears,
}: Props) {
  const searchParams = useSearchParams();
  const lifeView = parseLifeView(searchParams.get("life"));
  const [projectId, setProjectId] = useQueryState("project", {
    defaultValue: projects[0]?.id ?? "",
  });
  const selected = projects.find((p) => p.id === projectId) ?? projects[0];
  const spTasks = tasks.filter((t) => t.projectId === selected?.id);
  const [railHost, setRailHost] = useState<HTMLDivElement | null>(null);
  const isDesktop = useIsDesktop();
  const [, startProjectMove] = useTransition();

  const handleMoveToProject = (taskId: string, nextProjectId: string) => {
    const destination =
      projects.find((p) => p.id === nextProjectId)?.title ?? "project";
    startProjectMove(async () => {
      const res = await setTaskProject({ id: taskId, projectId: nextProjectId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Moved to ${destination}`);
    });
  };

  // Multi-select across the board's three columns, in the order they render.
  const selection = useTaskSelection(useMemo(() => boardOrder(spTasks), [spTasks]));
  const selectedTasks = useMemo(
    () =>
      selection.active
        ? selection.ids
            .map((id) => spTasks.find((t) => t.id === id))
            .filter((t): t is Task => Boolean(t))
        : [],
    [selection.active, selection.ids, spTasks]
  );

  // Phone only: the bulk sheet opens from the selection bar, not from
  // selecting — a sheet would cover the very cards you're still picking.
  const [bulkSheet, setBulkSheet] = useState(false);
  useEffect(() => {
    if (!selection.active) setBulkSheet(false);
  }, [selection.active]);

  // In-place task editing: ?task=<id> swaps the right panel for the task editor.
  const [taskId, setTaskId] = useQueryState("task");
  // Phone: project details live in a bottom sheet behind the Details button.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const editingTask = taskId
    ? spTasks.find((t) => t.id === taskId) ?? null
    : null;

  // Drop a stale ?task (deleted task, or project switched) so the URL stays honest.
  useEffect(() => {
    if (taskId && !editingTask) void setTaskId(null);
  }, [taskId, editingTask, setTaskId]);

  return (
    <>
      <Topbar
        title="Projects"
        dayPct={stats.dayPct}
        habitsLabel={stats.habitsLabel}
        topStreak={stats.topStreak}
        birthDate={birthDate}
        lifeSpanYears={lifeSpanYears}
        activeProject={
          selected
            ? { title: selected.title, color: selected.color }
            : undefined
        }
      />
      <div className="flex min-h-0 flex-1 flex-col pb-6 animate-pumma-view">
        {/* The rail renders in here, portaled from inside the board's
            DndContext so its cards can receive dropped tasks. Without a board
            there's nothing to drag, so it renders plainly instead. */}
        <div ref={setRailHost} className="contents">
          {!selected && (
            <ProjectRail
              projects={projects}
              tasks={tasks}
              onSelect={(id) => void setProjectId(id)}
              lifeArea={lifeAreaForCreate(lifeView)}
            />
          )}
        </div>

        {selected ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 max-lg:gap-0 max-lg:overflow-hidden max-lg:pb-14 lg:grid lg:grid-cols-[1fr_minmax(280px,320px)] lg:overflow-hidden">
            {/* Clicking the board's empty space — a column's blank area, the
                gap between cards — closes the task editor and puts the project
                back in the right panel. Anything interactive is left alone, so
                this only ever fires on genuinely dead space. */}
            <div
              onClick={(e) => {
                if (!taskId) return;
                const el = e.target as HTMLElement;
                if (
                  el.closest(
                    ".kanban-card, button, a, input, textarea, select, [role=\"button\"]"
                  )
                ) {
                  return;
                }
                void setTaskId(null);
              }}
              className="flex min-h-0 flex-col overflow-hidden rounded-[14px] border border-border bg-surface max-lg:min-h-0 max-lg:flex-1"
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-border2 px-4 py-3">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ background: selected.color }}
                />
                <h3 className="m-0 min-w-0 flex-1 truncate text-sm font-bold">
                  {selected.title}
                </h3>
                <span className="font-mono text-[10px] text-faint max-lg:hidden">
                  kanban
                </span>
                <span
                  className="font-mono text-[10px] font-bold lg:hidden"
                  style={{ color: selected.color }}
                >
                  {projectProgress(selected.id, tasks).progress}%
                </span>
                <button
                  type="button"
                  onClick={() => setDetailsOpen(true)}
                  className="flex shrink-0 items-center gap-1 px-1 py-1 text-[11px] font-semibold text-muted transition-all active:scale-95 lg:hidden"
                >
                  <Pencil className="h-3 w-3" strokeWidth={2.2} />
                  Edit
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden p-3">
                <KanbanBoard
                  rail={
                    <ProjectRail
                      projects={projects}
                      tasks={tasks}
                      selectedId={selected.id}
                      onSelect={(id) => void setProjectId(id)}
                      lifeArea={lifeAreaForCreate(lifeView)}
                      droppable
                    />
                  }
                  railHost={railHost}
                  onMoveToProject={handleMoveToProject}
                  tasks={spTasks}
                  tags={tags}
                  onEditTask={(id) => void setTaskId(id)}
                  selection={selection}
                />
              </div>
            </div>
            {selection.active ? (
              <>
                <div className="hidden min-h-0 overflow-hidden animate-pumma-swap lg:block">
                  {isDesktop && (
                    <BulkEditPanel
                      tasks={selectedTasks}
                      tags={tags}
                      projects={projects}
                      onClear={selection.clear}
                    />
                  )}
                </div>
                <div className="lg:hidden">
                  <BottomSheet open={bulkSheet} onClose={() => setBulkSheet(false)}>
                    {bulkSheet && !isDesktop && (
                      <BulkEditPanel
                        tasks={selectedTasks}
                        tags={tags}
                        projects={projects}
                        onClear={selection.clear}
                      />
                    )}
                  </BottomSheet>
                </div>
              </>
            ) : editingTask ? (
              // Phone: draggable bottom sheet; desktop: in-grid panel.
              <>
                {/* One instance only: two mounted editors autosave over
                    each other (see lib/use-media-query). */}
                <div
                  key={editingTask.id}
                  className="hidden min-h-0 overflow-hidden animate-pumma-swap lg:block"
                >
                  {isDesktop && <TaskDetailPanel
                    task={editingTask}
                    tags={tags}
                    projects={projects}
                    onClose={() => void setTaskId(null)}
                    onBack={{
                      label: selected.title,
                      action: () => void setTaskId(null),
                    }}
                  />}
                </div>
                <div className="lg:hidden">
                  <BottomSheet open onClose={() => void setTaskId(null)}>
                    {!isDesktop && <TaskDetailPanel
                      task={editingTask}
                      tags={tags}
                      projects={projects}
                      onClose={() => void setTaskId(null)}
                      embedded
                    />}
                  </BottomSheet>
                </div>
              </>
            ) : (
              <div className="hidden min-h-0 lg:block">
                {isDesktop && <ProjectDetailPanel
                  project={selected}
                  goals={goals}
                  tasks={tasks}
                  tags={tags}
                  onDeleted={() => {
                    const remaining = projects.filter((p) => p.id !== selected.id);
                    void setProjectId(remaining[0]?.id ?? null);
                  }}
                />}
              </div>
            )}
            {detailsOpen && !isDesktop && (
              <div className="lg:hidden">
                <BottomSheet open onClose={() => setDetailsOpen(false)}>
                  <div className="h-full px-3 pb-4">
                    <ProjectDetailPanel
                      project={selected}
                      goals={goals}
                      tasks={tasks}
                      tags={tags}
                      onDeleted={() => {
                        setDetailsOpen(false);
                        const remaining = projects.filter(
                          (p) => p.id !== selected.id
                        );
                        void setProjectId(remaining[0]?.id ?? null);
                      }}
                    />
                  </div>
                </BottomSheet>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-[14px] border border-dashed border-border p-8 text-center">
            <p className="text-sm text-faint">No projects yet — create one to get started.</p>
            <NewProjectCard
              lifeArea={lifeAreaForCreate(lifeView)}
              onCreated={(id) => void setProjectId(id)}
              className="min-w-[220px]"
            />
          </div>
        )}
      </div>
      {selection.active && !isDesktop && (
        <SelectionBar
          count={selection.ids.length}
          onEdit={() => setBulkSheet(true)}
          onClear={selection.clear}
        />
      )}
    </>
  );
}
