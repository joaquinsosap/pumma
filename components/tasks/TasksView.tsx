"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  useQueryState,
  parseAsStringLiteral,
  parseAsString,
  parseAsArrayOf,
} from "nuqs";
import { ListTodo, Search, X } from "@/components/icons";
import { searchTasks } from "@/lib/task-search";
import { sortTasks, TASK_SORTS, type TaskSort } from "@/lib/collection-sort";
import { SortMenu } from "@/components/ui/sort-menu";
import { updateSettingsAction } from "@/lib/actions/settings";
import { setTaskProject } from "@/lib/actions/tasks";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  applyTaskFilters,
  countActiveFilters,
  TASK_STATUSES,
  TASK_PRIORITIES,
  type TaskFilters,
} from "@/lib/task-filters";
import {
  TaskFilterMenu,
  TaskFilterChips,
} from "@/components/tasks/TaskFilterMenu";
import type { Task, Tag, Project } from "@/lib/schemas";
import type { SelectionController } from "@/lib/use-task-selection";
import { TaskList } from "@/components/tasks/TaskList";
import { CarryoverSection } from "@/components/tasks/CarryoverSection";
import { TaskDetailPanel } from "@/components/tasks/TaskDetailPanel";
import { BulkEditPanel } from "@/components/tasks/BulkEditPanel";
import { SelectionBar } from "@/components/tasks/SelectionBar";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { iso } from "@/lib/date";
import { cn } from "@/lib/utils";
import { useTagMenu } from "@/components/tags/TagMenuProvider";
import { Topbar } from "@/components/shell/Topbar";
import { useTimezone } from "@/components/shell/TimeZoneProvider";
import { useIsDesktop } from "@/lib/use-media-query";
import { useTaskSelection } from "@/lib/use-task-selection";

const tabs = ["today", "upcoming", "all"] as const;
const groups = ["none", "tag", "project"] as const;

const TASK_ACCENT = "oklch(0.64 0.18 25)";

/**
 * The group under the pointer wins outright. closestCenter compares the
 * dragged row's centre instead, so a tall group two cards away could beat the
 * one you're actually over — the drop lands a group off and you learn to
 * overshoot. Falls back to closestCenter in the gaps between cards.
 */
const groupCollisionDetection: CollisionDetection = (args) => {
  const hit = pointerWithin(args);
  return hit.length ? hit : closestCenter(args);
};

type Props = {
  tasks: Task[];
  carryover: Task[];
  tags: Tag[];
  projects: Project[];
  stats: { dayPct: number; habitsLabel: string; topStreak: number };
  birthDate?: string | null;
  lifeSpanYears?: number;
  /** The saved ordering for this list. The view treats it as its own state. */
  taskSort?: TaskSort;
};

type Group = {
  label: string;
  count: number;
  color: string;
  items: Task[];
  /** Set only when grouping by project — the drop target's project, null for
   *  the "No project" bucket. Undefined means the group can't be dropped on. */
  dropProjectId?: string | null;
};

export function TasksView({
  tasks,
  carryover,
  tags,
  projects,
  stats,
  birthDate = null,
  lifeSpanYears,
  taskSort = "priority",
}: Props) {
  // The saved choice, applied locally the moment it changes. The server write
  // follows behind; waiting for it would make a sort menu feel like a page
  // load, and the sort itself is pure client work either way.
  const [sort, setSort] = useState<TaskSort>(taskSort);
  useEffect(() => setSort(taskSort), [taskSort]);
  const changeSort = (next: TaskSort) => {
    setSort(next);
    void updateSettingsAction({ taskSort: next });
  };
  const [tab, setTab] = useQueryState(
    "tab",
    // Opening Tasks from the nav shows everything; links that mean a specific
    // slice (Home's "Today's tasks", a task deep-link) pass ?tab= explicitly.
    parseAsStringLiteral(tabs).withDefault("all"),
  );
  const [group, setGroup] = useQueryState(
    "group",
    parseAsStringLiteral(groups).withDefault("none"),
  );
  const [taskId, setTaskId] = useQueryState("task");
  const [projectFilter, setProjectFilter] = useQueryState(
    "project",
    parseAsString,
  );
  const [query, setQuery] = useQueryState("q", parseAsString.withDefault(""));
  const [statusFilter, setStatusFilter] = useQueryState(
    "status",
    parseAsArrayOf(parseAsStringLiteral(TASK_STATUSES)).withDefault([]),
  );
  const [priorityFilter, setPriorityFilter] = useQueryState(
    "priority",
    parseAsArrayOf(parseAsStringLiteral(TASK_PRIORITIES)).withDefault([]),
  );
  const [tagFilter, setTagFilter] = useQueryState(
    "tag",
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const listRef = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();
  const { setDragActive } = useTagMenu();
  const timeZone = useTimezone();
  const isDesktop = useIsDesktop();
  const td = iso(new Date(), timeZone);

  const selectedTask = useMemo(
    () => (taskId ? (tasks.find((t) => t.id === taskId) ?? null) : null),
    [tasks, taskId],
  );

  useEffect(() => {
    if (taskId && !selectedTask) setTaskId(null);
  }, [taskId, selectedTask, setTaskId]);

  // Dragging a task from one project group into another. Only wired up while
  // grouping by project — that's the only view where the drop target means
  // something.
  const dragEnabled = group === "project";
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingTask = useMemo(
    () =>
      draggingId ? (tasks.find((t) => t.id === draggingId) ?? null) : null,
    [draggingId, tasks],
  );

  const sensors = useSensors(
    // A plain click must still open the task, so the mouse needs a little
    // travel first; touch needs a long-press or the list stops scrolling.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 280, tolerance: 8 },
    }),
    useSensor(KeyboardSensor),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setDragActive(true);
    setDraggingId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const taskId = String(event.active.id);
    setDraggingId(null);
    setDragActive(false);
    const target = event.over?.data.current;
    if (!target || target.type !== "project-group") return;

    const nextProjectId = (target.projectId ?? null) as string | null;
    const moved = tasks.find((t) => t.id === taskId);
    if (!moved || moved.projectId === nextProjectId) return;

    const destination = nextProjectId
      ? (projects.find((p) => p.id === nextProjectId)?.title ?? "project")
      : "No project";

    startTransition(async () => {
      const res = await setTaskProject({
        id: taskId,
        projectId: nextProjectId,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Moved to ${destination}`);
    });
  };

  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length > 0;

  const filters = useMemo<TaskFilters>(
    () => ({
      status: statusFilter,
      priority: priorityFilter,
      tagIds: tagFilter,
    }),
    [statusFilter, priorityFilter, tagFilter],
  );
  const filtersActive = countActiveFilters(filters) > 0;

  const setFilters = useCallback(
    (next: TaskFilters) => {
      // nuqs drops a param when it equals the default, so empty arrays become
      // null rather than "?status=".
      void setStatusFilter(next.status.length ? next.status : null);
      void setPriorityFilter(next.priority.length ? next.priority : null);
      void setTagFilter(next.tagIds.length ? next.tagIds : null);
    },
    [setStatusFilter, setPriorityFilter, setTagFilter],
  );

  const filtered = useMemo(() => {
    let items: Task[];
    if (searching) {
      // Searching looks past the tab on purpose: hunting for a task you can't
      // find is the whole point, and "no results" because it's due next week
      // would be a lie. Overdue carryover joins the pool for the same reason.
      const byId = new Set(tasks.map((t) => t.id));
      const pool = [...tasks, ...carryover.filter((t) => !byId.has(t.id))];
      items = searchTasks(pool, trimmedQuery, { tags, projects });
    } else {
      items = tasks.filter((t) => {
        const d = (t.due ?? "").slice(0, 10);
        if (tab === "today") return d === td;
        if (tab === "upcoming") return d > td;
        return true;
      });
    }
    if (projectFilter) {
      items = items.filter((t) => t.projectId === projectFilter);
    }
    // Priority by default — same order as the home widget — or whatever the
    // sort menu picked instead.
    return sortTasks(applyTaskFilters(items, filters), sort);
  }, [
    tasks,
    carryover,
    tab,
    td,
    projectFilter,
    searching,
    trimmedQuery,
    tags,
    projects,
    filters,
    sort,
  ]);

  const filteredCarryover = useMemo(() => {
    const items = projectFilter
      ? carryover.filter((t) => t.projectId === projectFilter)
      : carryover;
    return sortTasks(applyTaskFilters(items, filters), sort);
  }, [carryover, projectFilter, filters, sort]);

  const todayTasks = useMemo(() => {
    let items = tasks.filter((t) => (t.due ?? "").slice(0, 10) === td);
    if (projectFilter) {
      items = items.filter((t) => t.projectId === projectFilter);
    }
    return items;
  }, [tasks, td, projectFilter]);

  const summary = useMemo(() => {
    const open = filtered.filter((t) => t.status !== "done").length;
    const doing = filtered.filter((t) => t.status === "doing").length;
    const todayDone = todayTasks.filter((t) => t.status === "done").length;
    return { open, doing, todayDone, todayTotal: todayTasks.length };
  }, [filtered, todayTasks]);

  const filteredProject = projectFilter
    ? projects.find((p) => p.id === projectFilter)
    : null;

  const showCarryover = tab === "today" && !searching;

  const taskGroups = useMemo((): Group[] => {
    if (group === "none") {
      const label =
        searching || filtersActive
          ? "Results"
          : (filteredProject?.title ??
            (tab === "today"
              ? "Today"
              : tab === "upcoming"
                ? "Upcoming"
                : "All tasks"));
      return [
        {
          label,
          count: filtered.length,
          color: filteredProject?.color ?? TASK_ACCENT,
          items: filtered,
        },
      ];
    }
    if (group === "tag") {
      const result: Group[] = [];
      for (const tg of tags) {
        const items = filtered.filter((t) => t.tagIds.includes(tg.id));
        if (items.length) {
          result.push({
            label: tg.name,
            count: items.length,
            color: tg.color,
            items,
          });
        }
      }
      const untagged = filtered.filter((t) => !t.tagIds.length);
      if (untagged.length) {
        result.push({
          label: "untagged",
          count: untagged.length,
          color: "var(--faint2)",
          items: untagged,
        });
      }
      return result;
    }
    const result: Group[] = [];
    for (const pr of projects) {
      const items = filtered.filter((t) => t.projectId === pr.id);
      // Empty projects still render while grouping, so there's somewhere to
      // drop the first task into.
      result.push({
        label: pr.title,
        count: items.length,
        color: pr.color,
        items,
        dropProjectId: pr.id,
      });
    }
    result.push({
      label: "No project",
      count: filtered.filter((t) => !t.projectId).length,
      color: "var(--faint2)",
      items: filtered.filter((t) => !t.projectId),
      dropProjectId: null,
    });
    return result;
  }, [
    group,
    tags,
    projects,
    filtered,
    tab,
    filteredProject,
    searching,
    filtersActive,
  ]);

  // Every row on screen, top to bottom — a shift-range spans what the user can
  // see, so it has to follow the grouping and the carryover section rather
  // than the unfiltered task list.
  const orderedIds = useMemo(() => {
    const ids = taskGroups.flatMap((grp) => grp.items.map((t) => t.id));
    if (showCarryover) {
      const seen = new Set(ids);
      for (const t of filteredCarryover) if (!seen.has(t.id)) ids.push(t.id);
    }
    return ids;
  }, [taskGroups, showCarryover, filteredCarryover]);

  const selection = useTaskSelection(orderedIds);
  // Phone only: the bulk sheet is opened deliberately, not by selecting —
  // see SelectionBar. Selecting nothing closes it.
  const [bulkSheet, setBulkSheet] = useState(false);
  useEffect(() => {
    if (!selection.active) setBulkSheet(false);
  }, [selection.active]);

  const selectedTasks = useMemo(() => {
    if (!selection.active) return [];
    const pool = new Map<string, Task>();
    for (const t of tasks) pool.set(t.id, t);
    for (const t of carryover) if (!pool.has(t.id)) pool.set(t.id, t);
    return selection.ids
      .map((id) => pool.get(id))
      .filter((t): t is Task => Boolean(t));
  }, [selection.active, selection.ids, tasks, carryover]);

  useEffect(() => {
    if (projectFilter && !filteredProject) setProjectFilter(null);
  }, [projectFilter, filteredProject, setProjectFilter]);

  useEffect(() => {
    if (!taskId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-task-id="${taskId}"]`);
    if (!el) return;
    const timer = window.setTimeout(() => {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [taskId, taskGroups, tab, group, projectFilter]);

  const emptyCopy = searching
    ? filtersActive
      ? `Nothing matches "${trimmedQuery}" with these filters. Try clearing them.`
      : `Nothing matches "${trimmedQuery}". Search covers titles, descriptions, subtasks, tags and projects.`
    : filtersActive
      ? "No tasks match these filters. Clear one above to widen the net."
      : tab === "today"
        ? showCarryover && filteredCarryover.length
          ? "Nothing new due today. Finish carryover below, or check Upcoming."
          : "Nothing due today. Capture something above, or check Upcoming."
        : tab === "upcoming"
          ? "No upcoming tasks. You're clear ahead."
          : "No tasks yet. Use the capture bar to add one.";

  return (
    <>
      <Topbar
        title="Tasks"
        dayPct={stats.dayPct}
        habitsLabel={stats.habitsLabel}
        topStreak={stats.topStreak}
        birthDate={birthDate}
        lifeSpanYears={lifeSpanYears}
        activeProject={
          filteredProject
            ? {
                title: filteredProject.title,
                color: filteredProject.color,
                onClear: () => setProjectFilter(null),
              }
            : undefined
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className="flex shrink-0 flex-wrap items-center gap-3 rounded-[13px] border border-border bg-surface px-4 py-3 max-lg:mb-3 max-lg:gap-x-2 max-lg:gap-y-2 max-lg:px-3 max-lg:py-2.5 lg:mb-5"
          style={{ boxShadow: "2px 2px 0 var(--shadow)" }}
        >
          <SegControl
            value={tab}
            options={[
              ["today", "Today"],
              ["upcoming", "Upcoming"],
              ["all", "All"],
            ]}
            onChange={(v) => setTab(v as typeof tab)}
            accent={TASK_ACCENT}
          />
          <div className="hidden h-5 w-px bg-border sm:block" aria-hidden />
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-faint2 max-lg:hidden">
              Group
            </span>
            <SegControl
              value={group}
              options={[
                ["none", "None"],
                ["tag", "Tag"],
                ["project", "Project"],
              ]}
              onChange={(v) => setGroup(v as typeof group)}
              compact
            />
            {(group === "project" || filteredProject) && (
              <ProjectFilterControl
                projects={projects}
                value={projectFilter}
                selected={filteredProject}
                onChange={setProjectFilter}
                showPicker={group === "project"}
              />
            )}
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2 max-lg:ml-0 max-lg:w-full">
            <SearchField
              value={query}
              onChange={setQuery}
              resultCount={searching ? filtered.length : null}
            />
            <TaskFilterMenu
              filters={filters}
              onChange={setFilters}
              tags={tags}
            />
            <SortMenu options={TASK_SORTS} value={sort} onChange={changeSort} />

            <div className="flex shrink-0 items-center gap-0.5 max-lg:hidden">
              <TaskStat
                value={
                  summary.todayTotal
                    ? `${summary.todayDone}/${summary.todayTotal}`
                    : "0"
                }
                label="TODAY DONE"
                accent={TASK_ACCENT}
              />
              <TaskStat
                value={String(summary.open)}
                label="OPEN"
                className="border-l border-border"
              />
              {summary.doing > 0 && (
                <TaskStat
                  value={String(summary.doing)}
                  label="IN PROGRESS"
                  className="border-l border-border text-primary"
                />
              )}
            </div>
          </div>
        </div>

        <TaskFilterChips filters={filters} onChange={setFilters} tags={tags} />

        <div
          className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-[13px] border border-border bg-surface animate-pumma-view lg:grid-cols-[minmax(280px,34%)_minmax(480px,1fr)]"
          style={{ boxShadow: "2px 2px 0 var(--shadow)" }}
        >
          <div
            ref={listRef}
            className="min-h-0 overflow-y-auto p-3 max-lg:pb-28 lg:border-r lg:border-border2 lg:p-4"
          >
            <DragArea
              enabled={dragEnabled}
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onDragCancel={() => {
                setDraggingId(null);
                setDragActive(false);
              }}
              overlay={
                draggingTask ? (
                  <div className="pointer-events-none rounded-lg border-2 border-ink bg-surface px-3 py-2 text-[13px] font-semibold text-ink shadow-[3px_3px_0_var(--shadow)]">
                    {draggingTask.title}
                  </div>
                ) : null
              }
            >
              <div className="flex flex-col gap-4">
                {!filtered.length &&
                !(showCarryover && filteredCarryover.length) ? (
                  <div className="rounded-[13px] border-2 border-dashed border-border bg-surface2/50 px-6 py-12 text-center">
                    <div
                      className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface"
                      style={{ color: TASK_ACCENT }}
                    >
                      {searching || filtersActive ? (
                        <Search className="h-5 w-5" />
                      ) : (
                        <ListTodo className="h-5 w-5" />
                      )}
                    </div>
                    <p className="m-0 text-sm font-semibold text-ink">
                      {searching || filtersActive ? "No matches" : "All clear"}
                    </p>
                    <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-faint">
                      {emptyCopy}
                    </p>
                  </div>
                ) : (
                  taskGroups
                    // Empty project groups stay while dragging, so there's
                    // somewhere to drop the first task into.
                    .filter((grp) => grp.items.length > 0 || dragEnabled)
                    .map((grp) => (
                      <TaskGroupCard
                        key={grp.label}
                        group={grp}
                        tags={tags}
                        selectedId={taskId}
                        onSelect={(id) => setTaskId(taskId === id ? null : id)}
                        draggable={dragEnabled}
                        selection={selection}
                      />
                    ))
                )}
                {showCarryover && filteredCarryover.length > 0 && (
                  <CarryoverSection
                    tasks={filteredCarryover}
                    tags={tags}
                    variant="page"
                    selectedId={taskId}
                    onSelect={(id) => setTaskId(taskId === id ? null : id)}
                    flat
                    selection={selection}
                  />
                )}
              </div>
            </DragArea>
          </div>

          {/* Desktop: right-hand pane. Phone: draggable bottom sheet.
              Only ONE is mounted at a time — `hidden lg:block` would keep both
              alive, and two editors autosaving the same task overwrite each
              other's drafts. */}
          <div className="hidden min-h-0 overflow-hidden bg-surface2/20 lg:block">
            {selection.active ? (
              isDesktop && (
                <BulkEditPanel
                  tasks={selectedTasks}
                  tags={tags}
                  projects={projects}
                  onClear={selection.clear}
                />
              )
            ) : selectedTask ? (
              isDesktop && (
                <div
                  key={selectedTask.id}
                  className="animate-pumma-swap h-full"
                >
                  <TaskDetailPanel
                    task={selectedTask}
                    tags={tags}
                    projects={projects}
                    onClose={() => setTaskId(null)}
                    embedded
                  />
                </div>
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                <p className="m-0 text-sm font-semibold text-ink">
                  Select a task
                </p>
                <p className="mt-1.5 max-w-[240px] text-[13px] leading-relaxed text-faint">
                  Description, subtasks, priority, and tags live here.
                </p>
              </div>
            )}
          </div>
          <BottomSheet
            open={bulkSheet || (!selection.active && !!selectedTask)}
            onClose={() => (bulkSheet ? setBulkSheet(false) : setTaskId(null))}
          >
            {bulkSheet && !isDesktop && (
              <BulkEditPanel
                tasks={selectedTasks}
                tags={tags}
                projects={projects}
                onClear={selection.clear}
              />
            )}
            {!bulkSheet && !selection.active && selectedTask && !isDesktop && (
              <div key={selectedTask.id} className="animate-pumma-swap">
                <TaskDetailPanel
                  task={selectedTask}
                  tags={tags}
                  projects={projects}
                  onClose={() => setTaskId(null)}
                  embedded
                />
              </div>
            )}
          </BottomSheet>
        </div>
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

function SearchField({
  value,
  onChange,
  resultCount,
}: {
  value: string;
  onChange: (v: string) => void;
  resultCount: number | null;
}) {
  return (
    <div className="flex min-w-[120px] max-w-[280px] flex-1 items-center gap-2 rounded-lg border border-border bg-surface2 px-2.5 py-1.5 transition-colors focus-within:border-faint">
      <Search className="h-3.5 w-3.5 shrink-0 text-faint2" strokeWidth={2.2} />
      {/* Deliberately not type="search": WebKit adds its own clear button and
          we'd render two. */}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            // Stop here so the global Esc handler doesn't also clear the
            // capture bar on the same press.
            e.preventDefault();
            e.stopPropagation();
            onChange("");
          }
        }}
        placeholder="Search tasks…"
        aria-label="Search tasks"
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint2"
      />
      {resultCount !== null && (
        <span className="shrink-0 font-mono text-[10px] font-semibold text-faint">
          {resultCount}
        </span>
      )}
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="flex shrink-0 items-center justify-center rounded text-faint transition-colors hover:text-ink"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function TaskStat({
  value,
  label,
  className,
  accent,
}: {
  value: string;
  label: string;
  className?: string;
  accent?: string;
}) {
  return (
    <div className={cn("px-3 py-0.5 text-right", className)}>
      <div
        className="text-lg font-extrabold leading-none text-ink"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      <div className="mt-0.5 font-mono text-[9px] tracking-wide text-faint">
        {label}
      </div>
    </div>
  );
}

/**
 * Only mounts a DndContext when dragging is actually on, so every other view of
 * this list keeps its old, plain render tree.
 */
function DragArea({
  enabled,
  sensors,
  onDragStart,
  onDragEnd,
  onDragCancel,
  overlay,
  children,
}: {
  enabled: boolean;
  sensors: ReturnType<typeof useSensors>;
  onDragStart: (e: DragStartEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
  onDragCancel: () => void;
  overlay: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={groupCollisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      {children}
      <DragOverlay dropAnimation={null}>{overlay}</DragOverlay>
    </DndContext>
  );
}

function TaskGroupCard({
  group,
  tags,
  selectedId,
  onSelect,
  draggable = false,
  selection,
}: {
  group: Group;
  tags: Tag[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  draggable?: boolean;
  selection?: SelectionController;
}) {
  const open = group.items.filter((t) => t.status !== "done").length;
  const droppable = draggable && group.dropProjectId !== undefined;
  const { setNodeRef, isOver } = useDroppable({
    id: `project-group:${group.dropProjectId ?? "none"}`,
    disabled: !droppable,
    data: { type: "project-group", projectId: group.dropProjectId },
  });

  return (
    <section
      ref={droppable ? setNodeRef : undefined}
      className={cn(
        "overflow-hidden rounded-lg border bg-surface transition-colors",
        isOver
          ? "border-primary/50 bg-primary/[0.04] ring-1 ring-inset ring-primary/25"
          : "border-border2",
      )}
    >
      <header className="flex items-center gap-2.5 border-b border-border2 bg-surface2/60 px-4 py-3">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: group.color }}
        />
        <h3 className="m-0 text-sm font-bold capitalize text-ink">
          {group.label}
        </h3>
        <span className="rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[10px] font-semibold text-faint">
          {group.count}
        </span>
        {open < group.count && (
          <span className="ml-auto font-mono text-[10px] text-faint">
            {open} open
          </span>
        )}
      </header>
      {group.items.length ? (
        <TaskList
          tasks={group.items}
          tags={tags}
          showDelete
          dueField="full"
          variant="page"
          selectedId={selectedId}
          onSelect={onSelect}
          draggableTasks={draggable}
          selection={selection}
        />
      ) : (
        <p className="m-0 px-4 py-5 text-center font-mono text-[11px] text-faint2">
          Drop a task here
        </p>
      )}
    </section>
  );
}

function ProjectFilterControl({
  projects,
  value,
  selected,
  onChange,
  showPicker,
}: {
  projects: Project[];
  value: string | null;
  selected: Project | null | undefined;
  onChange: (id: string | null) => void;
  showPicker: boolean;
}) {
  if (selected) {
    return (
      <div
        className="flex max-w-[200px] items-center gap-1.5 rounded-lg border-2 px-2 py-1"
        style={{
          borderColor: selected.color,
          background: selected.color.replace(")", " / 0.12)"),
        }}
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
          style={{ background: selected.color }}
        />
        <span className="min-w-0 truncate text-[11px] font-bold text-ink">
          {selected.title}
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="ml-0.5 flex shrink-0 items-center justify-center rounded text-faint hover:text-ink"
          aria-label="Clear project filter"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  if (!showPicker) return null;

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="max-w-[160px] truncate rounded-lg border border-border bg-surface px-2 py-1 font-mono text-[11px] text-ink outline-none focus:border-faint"
      aria-label="Filter by project"
    >
      <option value="">All projects</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.title}
        </option>
      ))}
    </select>
  );
}

function SegControl({
  value,
  options,
  onChange,
  accent = "var(--primary)",
  compact,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
  accent?: string;
  compact?: boolean;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-border bg-surface2 p-1">
      {options.map(([k, label]) => {
        const active = value === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className={cn(
              "rounded-md font-semibold transition-all",
              compact
                ? "px-2.5 py-1 text-[11px] max-lg:px-2"
                : "px-3.5 py-1.5 text-[12.5px] max-lg:px-2.5 max-lg:py-1 max-lg:text-[11.5px]",
              active
                ? "border-2 font-bold text-background shadow-[1px_1px_0_var(--shadow)]"
                : "border border-transparent text-muted hover:bg-hover",
            )}
            /* The default used to be `--ink`, which is near-black on light
               and near-*white* on dark — so the selected segment became a
               white pill carrying white text. The accent is the ground in
               both themes now, and it is a colour by definition. */
            style={
              active ? { background: accent, borderColor: accent } : undefined
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
