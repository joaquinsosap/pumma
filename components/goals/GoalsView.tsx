"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useQueryState, parseAsString } from "nuqs";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  Goal,
  Habit,
  HabitEntry,
  Project,
  Tag,
  Task,
} from "@/lib/schemas";
import { updateGoalsLayoutAction } from "@/lib/actions/goals";
import { goalHasLinks } from "@/lib/goal-sync";
import { Topbar } from "@/components/shell/Topbar";
import { GoalDetailPanel } from "@/components/goals/GoalDetailPanel";
import { useIsDesktop } from "@/lib/use-media-query";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import type { GoalCategory } from "@/lib/types";
import type { WeekStart } from "@/lib/date";
import type { HabitVisibilitySettings } from "@/lib/habit-visibility";
import { cn } from "@/lib/utils";

const CATEGORIES: GoalCategory[] = ["personal", "work"];

type ItemsByCategory = Record<GoalCategory, Goal[]>;

type Props = {
  goals: Goal[];
  tags: Tag[];
  projects: Project[];
  habits: Habit[];
  habitEntries: HabitEntry[];
  tasks: Task[];
  stats: { dayPct: number; habitsLabel: string; topStreak: number };
  habitVisibility: HabitVisibilitySettings;
  weekStart: WeekStart;
  birthDate?: string | null;
  lifeSpanYears?: number;
};

function groupByCategory(goals: Goal[]): ItemsByCategory {
  return {
    personal: goals
      .filter((g) => g.category === "personal")
      .sort((a, b) => a.order - b.order),
    work: goals
      .filter((g) => g.category === "work")
      .sort((a, b) => a.order - b.order),
  };
}

function layoutIds(layout: ItemsByCategory) {
  return {
    personal: layout.personal.map((g) => g.id),
    work: layout.work.map((g) => g.id),
  };
}

function layoutChanged(a: ItemsByCategory, b: ItemsByCategory) {
  const left = layoutIds(a);
  const right = layoutIds(b);
  return (
    left.personal.join() !== right.personal.join() ||
    left.work.join() !== right.work.join()
  );
}

function findContainer(
  id: UniqueIdentifier,
  items: ItemsByCategory,
): GoalCategory | undefined {
  if (id === "personal" || id === "work") return id;
  return CATEGORIES.find((cat) => items[cat].some((g) => g.id === id));
}

export function GoalsView({
  goals,
  tags,
  projects,
  habits,
  habitEntries,
  tasks,
  stats,
  habitVisibility,
  weekStart,
  birthDate = null,
  lifeSpanYears,
}: Props) {
  const [, startTransition] = useTransition();
  const [goalId, setGoalId] = useQueryState("goal", parseAsString);
  const isDesktop = useIsDesktop();
  const serverLayout = useMemo(() => groupByCategory(goals), [goals]);
  const [items, setItems] = useState<ItemsByCategory>(() => serverLayout);
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [dragReady, setDragReady] = useState(false);
  const itemsRef = useRef(items);
  const serverLayoutRef = useRef(serverLayout);
  const persistPendingRef = useRef(false);

  const selectedGoal = useMemo(
    () => (goalId ? (goals.find((g) => g.id === goalId) ?? null) : null),
    [goals, goalId],
  );

  useEffect(() => {
    if (goalId && !selectedGoal) setGoalId(null);
  }, [goalId, selectedGoal, setGoalId]);

  useEffect(() => {
    setDragReady(true);
  }, []);

  useEffect(() => {
    setItems(serverLayout);
    itemsRef.current = serverLayout;
    serverLayoutRef.current = serverLayout;
  }, [serverLayout]);

  const persistLayout = useCallback((next: ItemsByCategory) => {
    if (!layoutChanged(serverLayoutRef.current, next)) return;
    if (persistPendingRef.current) return;
    persistPendingRef.current = true;

    startTransition(async () => {
      try {
        const ids = layoutIds(next);
        // Layout action revalidates the route; the optimistic dnd order
        // holds until it lands — no extra refresh round-trip.
        await updateGoalsLayoutAction(ids.personal, ids.work);
      } finally {
        persistPendingRef.current = false;
      }
    });
  }, []);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 280, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const activeGoal = useMemo(() => {
    if (!activeId) return null;
    for (const cat of CATEGORIES) {
      const column = items[cat];
      const hit = column.find((g) => g.id === activeId);
      if (hit) {
        return {
          goal: hit,
          index: column.findIndex((g) => g.id === activeId),
          cat,
        };
      }
    }
    return null;
  }, [activeId, items]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    setItems((prev) => {
      const activeContainer = findContainer(active.id, prev);
      const overContainer = findContainer(over.id, prev);
      if (
        !activeContainer ||
        !overContainer ||
        activeContainer === overContainer
      ) {
        return prev;
      }

      const activeItems = [...prev[activeContainer]];
      const overItems = [...prev[overContainer]];
      const activeIndex = activeItems.findIndex((g) => g.id === active.id);
      if (activeIndex < 0) return prev;

      const [moved] = activeItems.splice(activeIndex, 1);
      const updated: Goal = { ...moved, category: overContainer };
      const overIndex = overItems.findIndex((g) => g.id === over.id);

      overItems.splice(
        overIndex >= 0 ? overIndex : overItems.length,
        0,
        updated,
      );

      const next = {
        ...prev,
        [activeContainer]: activeItems,
        [overContainer]: overItems,
      };
      itemsRef.current = next;
      return next;
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) {
      const reset = serverLayoutRef.current;
      setItems(reset);
      itemsRef.current = reset;
      return;
    }

    const prev = itemsRef.current;
    const activeContainer = findContainer(active.id, prev);
    const overContainer = findContainer(over.id, prev);
    if (!activeContainer || !overContainer) return;

    let next = prev;

    if (activeContainer === overContainer) {
      const columnItems = prev[activeContainer];
      const oldIndex = columnItems.findIndex((g) => g.id === active.id);
      const newIndex = columnItems.findIndex((g) => g.id === over.id);
      if (oldIndex !== newIndex && newIndex >= 0) {
        next = {
          ...prev,
          [activeContainer]: arrayMove(columnItems, oldIndex, newIndex),
        };
      }
    }

    setItems(next);
    itemsRef.current = next;
    persistLayout(next);
  };

  const handleDragCancel = () => {
    setActiveId(null);
    const reset = serverLayoutRef.current;
    setItems(reset);
    itemsRef.current = reset;
  };

  return (
    <>
      <Topbar
        title="Goals"
        dayPct={stats.dayPct}
        habitsLabel={stats.habitsLabel}
        topStreak={stats.topStreak}
        birthDate={birthDate}
        lifeSpanYears={lifeSpanYears}
      />
      <div
        className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-[13px] border border-border bg-surface animate-pumma-view lg:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]"
        style={{ boxShadow: "2px 2px 0 var(--shadow)" }}
      >
        <div className="min-h-0 overflow-y-auto p-3 max-lg:pb-28 lg:border-r lg:border-border2 lg:p-4">
          {dragReady ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <div className="grid gap-[18px] lg:grid-cols-2">
                <GoalColumn
                  title="Personal"
                  color="oklch(0.58 0.17 300)"
                  textColor="oklch(0.46 0.17 300)"
                  category="personal"
                  goals={items.personal}
                  projects={projects}
                  habits={habits}
                  selectedId={goalId}
                  onSelect={setGoalId}
                  isDragging={activeId !== null}
                />
                <GoalColumn
                  title="Work"
                  color="oklch(0.58 0.14 245)"
                  textColor="oklch(0.44 0.14 245)"
                  category="work"
                  goals={items.work}
                  projects={projects}
                  habits={habits}
                  selectedId={goalId}
                  onSelect={setGoalId}
                  isDragging={activeId !== null}
                />
              </div>

              <DragOverlay dropAnimation={dropAnimation}>
                {activeGoal ? (
                  <GoalCard
                    goal={activeGoal.goal}
                    index={activeGoal.index}
                    color={
                      activeGoal.cat === "personal"
                        ? "oklch(0.58 0.17 300)"
                        : "oklch(0.58 0.14 245)"
                    }
                    textColor={
                      activeGoal.cat === "personal"
                        ? "oklch(0.46 0.17 300)"
                        : "oklch(0.44 0.14 245)"
                    }
                    projects={projects}
                    habits={habits}
                    selected={false}
                    overlay
                  />
                ) : null}
              </DragOverlay>
            </DndContext>
          ) : (
            <div className="grid gap-[18px] lg:grid-cols-2">
              <GoalColumnStatic
                title="Personal"
                color="oklch(0.58 0.17 300)"
                textColor="oklch(0.46 0.17 300)"
                category="personal"
                goals={items.personal}
                projects={projects}
                habits={habits}
                selectedId={goalId}
                onSelect={setGoalId}
              />
              <GoalColumnStatic
                title="Work"
                color="oklch(0.58 0.14 245)"
                textColor="oklch(0.44 0.14 245)"
                category="work"
                goals={items.work}
                projects={projects}
                habits={habits}
                selectedId={goalId}
                onSelect={setGoalId}
              />
            </div>
          )}
        </div>

        {/* Desktop: right-hand pane. Phone: draggable bottom sheet. */}
        <div className="hidden min-h-0 overflow-hidden bg-surface2/20 lg:block">
          {selectedGoal ? (
            isDesktop && (
              <div key={selectedGoal.id} className="animate-pumma-swap h-full">
                <GoalDetailPanel
                  goal={selectedGoal}
                  tags={tags}
                  projects={projects}
                  habits={habits}
                  habitEntries={habitEntries}
                  tasks={tasks}
                  habitVisibility={habitVisibility}
                  weekStart={weekStart}
                  onClose={() => setGoalId(null)}
                />
              </div>
            )
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <p className="m-0 text-sm font-semibold text-ink">
                Select a goal
              </p>
              <p className="mt-1.5 max-w-[240px] text-[13px] leading-relaxed text-faint">
                Edit details, link habits with streak targets, and attach
                projects that roll up into progress.
              </p>
            </div>
          )}
        </div>
        <BottomSheet open={!!selectedGoal} onClose={() => setGoalId(null)}>
          {selectedGoal && !isDesktop && (
            <GoalDetailPanel
              goal={selectedGoal}
              tags={tags}
              projects={projects}
              habits={habits}
              habitEntries={habitEntries}
              tasks={tasks}
              habitVisibility={habitVisibility}
              weekStart={weekStart}
              onClose={() => setGoalId(null)}
            />
          )}
        </BottomSheet>
      </div>
    </>
  );
}

const dropAnimation = {
  duration: 220,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
};

function GoalColumnStatic({
  title,
  color,
  textColor,
  goals,
  projects,
  habits,
  category,
  selectedId,
  onSelect,
}: {
  title: string;
  color: string;
  textColor: string;
  goals: Goal[];
  projects: Project[];
  habits: Habit[];
  category: GoalCategory;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <div className="rounded-[13px] p-1">
      <div className="mb-3 flex items-center gap-2 px-1">
        <span
          className="h-[9px] w-[9px] rotate-45"
          style={{ background: color }}
        />
        <h3 className="m-0 text-[15px] font-bold">{title}</h3>
        <span className="font-mono text-[10px] text-faint">{goals.length}</span>
      </div>
      <div className="min-h-[120px] rounded-[11px] border border-transparent p-1">
        <div className="flex flex-col gap-2">
          {goals.map((g, index) => (
            <button
              key={g.id}
              type="button"
              className="w-full cursor-pointer border-none bg-transparent p-0 text-left"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(selectedId === g.id ? null : g.id);
              }}
            >
              <GoalCard
                goal={g}
                index={index}
                color={color}
                textColor={textColor}
                projects={projects}
                habits={habits}
                selected={selectedId === g.id}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function GoalColumn({
  title,
  color,
  textColor,
  goals,
  projects,
  habits,
  category,
  selectedId,
  onSelect,
  isDragging,
}: {
  title: string;
  color: string;
  textColor: string;
  goals: Goal[];
  projects: Project[];
  habits: Habit[];
  category: GoalCategory;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  isDragging: boolean;
}) {
  // No click-to-select: both columns are visible at once, so a "current"
  // column was state you could set but never see the point of. A new goal
  // follows the life area you are in, or the tag you typed.
  const { setNodeRef, isOver } = useDroppable({ id: category });

  return (
    <div className="rounded-[13px] p-1">
      <div className="mb-3 flex items-center gap-2 px-1">
        <span
          className="h-[9px] w-[9px] rotate-45"
          style={{ background: color }}
        />
        <h3 className="m-0 text-[15px] font-bold">{title}</h3>
        <span className="font-mono text-[10px] text-faint">{goals.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-[120px] rounded-[11px] border border-transparent p-1 transition-colors",
          isOver && "border-primary/35 bg-primary/[0.04]",
          isDragging && !isOver && "opacity-95",
        )}
      >
        <SortableContext
          items={goals.map((g) => g.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex flex-col gap-2">
            {goals.map((g, index) => (
              <SortableGoalCard
                key={g.id}
                goal={g}
                index={index}
                color={color}
                textColor={textColor}
                projects={projects}
                habits={habits}
                selected={selectedId === g.id}
                onSelect={() => onSelect(selectedId === g.id ? null : g.id)}
              />
            ))}
          </div>
        </SortableContext>
      </div>
    </div>
  );
}

function SortableGoalCard({
  goal,
  index,
  color,
  textColor,
  projects,
  habits,
  selected,
  onSelect,
}: {
  goal: Goal;
  index: number;
  color: string;
  textColor: string;
  projects: Project[];
  habits: Habit[];
  selected: boolean;
  onSelect: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: goal.id,
    data: { type: "goal", category: goal.category },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "kanban-card cursor-grab touch-manipulation active:cursor-grabbing",
        isDragging && "kanban-card--dragging opacity-35",
      )}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <GoalCard
        goal={goal}
        index={index}
        color={color}
        textColor={textColor}
        projects={projects}
        habits={habits}
        selected={selected}
      />
    </div>
  );
}

function GoalCard({
  goal,
  index,
  color,
  textColor,
  projects,
  habits,
  selected,
  overlay = false,
}: {
  goal: Goal;
  index: number;
  color: string;
  textColor: string;
  projects: Project[];
  habits: Habit[];
  selected: boolean;
  overlay?: boolean;
}) {
  const auto = goalHasLinks(goal.id, projects, habits);

  return (
    <div
      className={cn(
        "rounded-[13px] border bg-surface p-[12px_14px]",
        selected ? "border-ink shadow-sm" : "border-border",
        overlay
          ? "kanban-card--overlay rotate-[1deg] cursor-grabbing shadow-lg"
          : "hover:border-faint2",
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-0.5 shrink-0 font-mono text-[11px] font-semibold tabular-nums text-faint">
          {index + 1}.
        </span>
        <span className="min-w-0 flex-1 text-[14px] font-bold leading-snug">
          {goal.title}
        </span>
        <span
          className="shrink-0 font-mono text-[12px] font-semibold"
          style={{ color: textColor }}
        >
          {goal.progress}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border2">
        <div
          className="h-full"
          style={{ width: `${goal.progress}%`, background: color }}
        />
      </div>
      <p className="mt-2 font-mono text-[9px] text-faint">
        {auto ? "Linked habits & projects" : "Manual progress"}
      </p>
    </div>
  );
}
