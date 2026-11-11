"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Pencil } from "@/components/icons";
import { useQueryState } from "nuqs";
import type { Goal, Project, Task, Tag } from "@/lib/schemas";
import { projectProgress } from "@/lib/metrics";
import { parseLifeView } from "@/lib/life-area";
import { Topbar } from "@/components/shell/Topbar";
import { KanbanBoard, boardOrder } from "@/components/projects/KanbanBoard";
import { arrayMove } from "@dnd-kit/sortable";
import {
  setReversedIn,
  sortProjects,
  PROJECT_SORTS,
  PROJECT_TASK_SORTS,
  type ProjectSort,
  type ProjectTaskSort,
} from "@/lib/collection-sort";
import { reorderProjectsAction } from "@/lib/actions/projects";
import { SortMenu } from "@/components/ui/sort-menu";
import { updateSettingsAction } from "@/lib/actions/settings";
import { ProjectDetailPanel } from "@/components/projects/ProjectDetailPanel";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";
import { BulkEditPanel } from "@/components/tasks/BulkEditPanel";
import { SelectionBar } from "@/components/tasks/SelectionBar";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { NewProjectCard } from "@/components/projects/NewProjectCard";
import { FromJiraCard, ProjectRail } from "@/components/projects/ProjectRail";
import {
  JiraPullSheet,
  type JiraLookAgain,
} from "@/components/projects/JiraPullSheet";
import { JiraImportButton } from "@/components/projects/JiraImportButton";
import { CaptureButton } from "@/components/shell/CaptureButton";
import { ticketFromUrl } from "@/lib/ticket-link";
import { setTaskProject } from "@/lib/actions/tasks";
import { toast } from "sonner";
import { useIsDesktop } from "@/lib/use-media-query";
import { useTaskSelection } from "@/lib/use-task-selection";
import { lifeAreaForCreate } from "@/lib/life-area";
import { trySave } from "@/lib/try-save";
import { paint } from "@/lib/themes";

type Props = {
  projects: Project[];
  tasks: Task[];
  tags: Tag[];
  goals: Goal[];
  stats: { dayPct: number; habitsLabel: string; topStreak: number };
  birthDate?: string | null;
  lifeSpanYears?: number;
  projectSort?: ProjectSort;
  projectTaskSort?: ProjectTaskSort;
  sortReversed?: string[];
  /** A Jira address and token are saved, so tickets can be brought in. */
  jiraConnected?: boolean;
};

export function ProjectsView({
  projects: rawProjects,
  tasks,
  tags,
  goals,
  stats,
  birthDate = null,
  lifeSpanYears,
  projectSort = "created",
  projectTaskSort = "priority",
  sortReversed: sortReversedSetting = [],
  jiraConnected = false,
}: Props) {
  const searchParams = useSearchParams();
  const lifeView = parseLifeView(searchParams.get("life"));

  // Applies locally the moment it changes; the server write follows behind.
  // See TasksView for the reasoning.
  const [taskSort, setTaskSort] = useState<ProjectTaskSort>(projectTaskSort);
  useEffect(() => setTaskSort(projectTaskSort), [projectTaskSort]);
  const changeTaskSort = (next: ProjectTaskSort) => {
    setTaskSort(next);
    setTaskReversed(false);
    void updateSettingsAction({
      projectTaskSort: next,
      sortReversed: setReversedIn(sortReversedSetting, "projectTask", false),
    });
  };
  const [taskReversed, setTaskReversed] = useState(
    sortReversedSetting.includes("projectTask"),
  );
  const changeTaskReversed = (next: boolean) => {
    setTaskReversed(next);
    void updateSettingsAction({
      sortReversed: setReversedIn(sortReversedSetting, "projectTask", next),
    });
  };
  // Dragging a card IS choosing an order, so the choice follows the hand:
  // the board flips to custom and the menu says so, without a click.
  const arrangedByHand = () => {
    if (taskSort === "custom" && !taskReversed) return;
    setTaskSort("custom");
    // Forwards again: the drop wrote the order the user just made, and
    // showing it reversed would move the card away from where they put it.
    setTaskReversed(false);
    void updateSettingsAction({
      projectTaskSort: "custom",
      sortReversed: setReversedIn(sortReversedSetting, "projectTask", false),
    });
  };

  // The rail's own ordering, applied the moment it is picked like the board's.
  const [sort, setSort] = useState<ProjectSort>(projectSort);
  useEffect(() => setSort(projectSort), [projectSort]);
  const [reversed, setReversed] = useState(
    sortReversedSetting.includes("project"),
  );
  useEffect(
    () => setReversed(sortReversedSetting.includes("project")),
    [sortReversedSetting],
  );
  // The order a drag just made, shown until the server's copy says the same.
  const [handOrder, setHandOrder] = useState<string[] | null>(null);
  useEffect(() => {
    if (!handOrder) return;
    const saved = sortProjects(rawProjects, "custom").map((p) => p.id);
    const sameList =
      saved.length === handOrder.length &&
      saved.every((id) => handOrder.includes(id));
    // Let go once the save has landed, or the list itself changed under it.
    // Until then a refresh carrying the old order must not undo the drop, and
    // a second drag made meanwhile keeps its own order.
    if (!sameList || saved.every((id, i) => id === handOrder[i])) {
      setHandOrder(null);
    }
  }, [rawProjects, handOrder]);
  const changeSort = (next: ProjectSort) => {
    setSort(next);
    setReversed(false);
    setHandOrder(null);
    void updateSettingsAction({
      projectSort: next,
      sortReversed: setReversedIn(sortReversedSetting, "project", false),
    });
  };
  const changeReversed = (next: boolean) => {
    setReversed(next);
    void updateSettingsAction({
      sortReversed: setReversedIn(sortReversedSetting, "project", next),
    });
  };

  const projects = useMemo(() => {
    const sorted = sortProjects(rawProjects, sort, reversed, tasks);
    if (!handOrder) return sorted;
    const place = new Map(handOrder.map((id, i) => [id, i]));
    return [...sorted].sort(
      (a, b) =>
        (place.get(a.id) ?? handOrder.length) -
        (place.get(b.id) ?? handOrder.length),
    );
  }, [rawProjects, sort, reversed, tasks, handOrder]);
  const [projectId, setProjectId] = useQueryState("project", {
    defaultValue: projects[0]?.id ?? "",
    // Kept in the address even when it IS the first card. See the pin below.
    clearOnDefault: false,
  });
  const selected = projects.find((p) => p.id === projectId) ?? projects[0];
  // The first card is only where the page starts. The rail can reorder itself
  // now (Last edited does, with every task touched), and "the first" would
  // then swap the board, and the capture bar's target, under the user. So
  // whenever the address names no project, the one on screen is written in.
  const lastPinned = useRef<string | null>(null);
  useEffect(() => {
    if (!selected) return;
    if (searchParams.get("project")) {
      lastPinned.current = null;
      return;
    }
    if (lastPinned.current === selected.id) return;
    lastPinned.current = selected.id;
    void setProjectId(selected.id);
  }, [selected, searchParams, setProjectId]);
  const spTasks = tasks.filter((t) => t.projectId === selected?.id);
  const [railHost, setRailHost] = useState<HTMLDivElement | null>(null);
  const isDesktop = useIsDesktop();
  const [, startProjectMove] = useTransition();

  // Dropping one project card on another: the dragged card takes that place,
  // the rail shows it at once, and the menu reads Custom because it now is.
  const handleReorderProject = (dragId: string, overId: string) => {
    const ids = projects.map((p) => p.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return;
    const next = arrayMove(ids, from, to);
    const before = { sort, reversed };
    setHandOrder(next);
    setSort("custom");
    setReversed(false);
    startProjectMove(async () => {
      await trySave(
        () => reorderProjectsAction(next),
        () => {
          setSort(before.sort);
          setReversed(before.reversed);
          setHandOrder(null);
        },
      );
    });
  };

  const handleMoveToProject = (taskId: string, nextProjectId: string) => {
    const destination =
      projects.find((p) => p.id === nextProjectId)?.title ?? "project";
    startProjectMove(async () => {
      const res = await trySave(() =>
        setTaskProject({
          id: taskId,
          projectId: nextProjectId,
        }),
      );
      if (!res) return;
      toast.success(`Moved to ${destination}`);
    });
  };

  // Multi-select across the board's three columns, in the order they render.
  const selection = useTaskSelection(
    useMemo(
      () => boardOrder(spTasks, taskSort, taskReversed),
      [spTasks, taskSort, taskReversed],
    ),
  );
  const selectedTasks = useMemo(
    () =>
      selection.active
        ? selection.ids
            .map((id) => spTasks.find((t) => t.id === id))
            .filter((t): t is Task => Boolean(t))
        : [],
    [selection.active, selection.ids, spTasks],
  );

  // Phone only: the bulk sheet opens from the selection bar, not from
  // selecting — a sheet would cover the very cards you're still picking.
  const [bulkSheet, setBulkSheet] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  // No connection, no door: the rail draws the card only when this is set.
  const fromJira = jiraConnected ? () => setPullOpen(true) : undefined;
  // Projects that came from a ticket, in the rail's order: the sheet offers each as a shortcut to look it up again.
  const lookAgain = useMemo<JiraLookAgain[]>(() => {
    const seen = new Set<string>();
    return projects.flatMap((p) => {
      const key = ticketFromUrl(p.ticketUrl)?.key;
      if (!key || seen.has(key)) return [];
      seen.add(key);
      return [{ key, title: p.title, color: p.color }];
    });
  }, [projects]);
  useEffect(() => {
    if (!selection.active) setBulkSheet(false);
  }, [selection.active]);

  // In-place task editing: ?task=<id> swaps the right panel for the task editor.
  const [taskId, setTaskId] = useQueryState("task");
  // Phone: project details live in a bottom sheet behind the Details button.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const editingTask = taskId
    ? (spTasks.find((t) => t.id === taskId) ?? null)
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
        afterNew={
          fromJira ? (
            <JiraImportButton onClick={fromJira} className="max-lg:hidden" />
          ) : undefined
        }
      />
      <div className="flex min-h-0 flex-1 flex-col pb-6 animate-pumma-view">
        {projects.length > 1 && (
          <div className="mb-2 flex shrink-0 items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-faint2">
              {projects.length} projects
            </span>
            <SortMenu
              options={PROJECT_SORTS}
              value={sort}
              onChange={changeSort}
              reversed={reversed}
              onReversedChange={changeReversed}
            />
          </div>
        )}
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
              onFromJira={fromJira}
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
                    '.kanban-card, button, a, input, textarea, select, [role="button"]',
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
                  style={{ background: paint(selected.color) }}
                />
                <h3 className="m-0 min-w-0 truncate text-sm font-bold">
                  {selected.title}
                </h3>
                {/* Wide screens only, like the title's New button: a phone has the dock's plus. */}
                <CaptureButton type="task" className="max-lg:hidden" />
                <span className="min-w-0 flex-1" />
                <SortMenu
                  options={PROJECT_TASK_SORTS}
                  value={taskSort}
                  onChange={changeTaskSort}
                  reversed={taskReversed}
                  onReversedChange={changeTaskReversed}
                />
                <span
                  className="font-mono text-[10px] font-bold lg:hidden"
                  style={{ color: paint(selected.color) }}
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
                      sortable
                      onFromJira={fromJira}
                    />
                  }
                  railHost={railHost}
                  onMoveToProject={handleMoveToProject}
                  onReorderProject={handleReorderProject}
                  tasks={spTasks}
                  tags={tags}
                  onEditTask={(id) => void setTaskId(id)}
                  selection={selection}
                  sort={taskSort}
                  sortReversed={taskReversed}
                  onArrange={arrangedByHand}
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
                <BottomSheet
                  open={bulkSheet}
                  onClose={() => setBulkSheet(false)}
                >
                  {bulkSheet && !isDesktop && (
                    <BulkEditPanel
                      tasks={selectedTasks}
                      tags={tags}
                      projects={projects}
                      onClear={selection.clear}
                    />
                  )}
                </BottomSheet>
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
                  {isDesktop && (
                    <TaskDetailPanel
                      task={editingTask}
                      tags={tags}
                      projects={projects}
                      onClose={() => void setTaskId(null)}
                      onBack={{
                        label: selected.title,
                        action: () => void setTaskId(null),
                      }}
                    />
                  )}
                </div>
                <BottomSheet open onClose={() => void setTaskId(null)}>
                  {!isDesktop && (
                    <TaskDetailPanel
                      key={editingTask.id}
                      task={editingTask}
                      tags={tags}
                      projects={projects}
                      onClose={() => void setTaskId(null)}
                      embedded
                    />
                  )}
                </BottomSheet>
              </>
            ) : (
              <div className="hidden min-h-0 lg:block">
                {isDesktop && (
                  <ProjectDetailPanel
                    key={selected.id}
                    project={selected}
                    goals={goals}
                    tasks={tasks}
                    tags={tags}
                    onDeleted={() => {
                      const remaining = projects.filter(
                        (p) => p.id !== selected.id,
                      );
                      void setProjectId(remaining[0]?.id ?? null);
                    }}
                  />
                )}
              </div>
            )}
            {detailsOpen && !isDesktop && (
              <BottomSheet open onClose={() => setDetailsOpen(false)}>
                <div className="h-full px-3 pb-4">
                  <ProjectDetailPanel
                    key={selected.id}
                    project={selected}
                    goals={goals}
                    tasks={tasks}
                    tags={tags}
                    onDeleted={() => {
                      setDetailsOpen(false);
                      const remaining = projects.filter(
                        (p) => p.id !== selected.id,
                      );
                      void setProjectId(remaining[0]?.id ?? null);
                    }}
                  />
                </div>
              </BottomSheet>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-[14px] border border-dashed border-border p-8 text-center">
            <p className="text-sm text-faint">
              No projects yet. Create one to get started.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <NewProjectCard
                lifeArea={lifeAreaForCreate(lifeView)}
                onCreated={(id) => void setProjectId(id)}
                className="min-w-[220px]"
              />
              {fromJira && (
                <FromJiraCard onClick={fromJira} className="min-w-[220px]" />
              )}
            </div>
          </div>
        )}
      </div>
      {jiraConnected && (
        <JiraPullSheet
          open={pullOpen}
          onOpenChange={setPullOpen}
          again={lookAgain}
        />
      )}
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
