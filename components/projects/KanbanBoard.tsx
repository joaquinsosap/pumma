"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, Pencil } from "@/components/icons";
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
  type DragMoveEvent,
  type DragStartEvent,
  type UniqueIdentifier,
  pointerWithin,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task, Tag } from "@/lib/schemas";
import { tagBg } from "@/lib/parse";
import { moveTaskOnBoard } from "@/lib/actions/tasks";
import { TaskTimer } from "@/components/tasks/TaskTimer";
import { useTagMenu } from "@/components/tags/TagMenuProvider";
import {
  suppressRangeTextSelection,
  type SelectionController,
} from "@/lib/use-task-selection";
import { dropIndex } from "@/lib/kanban-drop";
import { sortTasks, type ProjectTaskSort } from "@/lib/collection-sort";
import { cn } from "@/lib/utils";

export type ColumnId = "todo" | "doing" | "done";

const COLS: { key: ColumnId; label: string; color: string }[] = [
  { key: "todo", label: "To do", color: "var(--faint2)" },
  { key: "doing", label: "Doing", color: "oklch(0.58 0.14 245)" },
  { key: "done", label: "Done", color: "oklch(0.6 0.13 155)" },
];

type ItemsByColumn = Record<ColumnId, Task[]>;

/**
 * The cards top-to-bottom, column by column — what a shift-range spans on the
 * board. Exported so the view can hand the same order to the selection hook
 * that the board renders in.
 */
export function boardOrder(
  tasks: Task[],
  sort: ProjectTaskSort = "custom",
): string[] {
  const by = groupByStatus(tasks, sort);
  return [...by.todo, ...by.doing, ...by.done].map((t) => t.id);
}

/**
 * A column, in the order the board should show it.
 *
 * "custom" reads `order`, which is what dropping a card writes; tasks never
 * arranged by hand carry their creation stamp there, so an untouched column
 * still comes out newest first. Any other sort is the shared comparator the
 * rest of the app uses — the board shows the ordering, and the first drag
 * flips the view back to custom (see onArrange).
 */
function column(
  tasks: Task[],
  status: Task["status"],
  sort: ProjectTaskSort,
): Task[] {
  return sortTasks(
    tasks.filter((t) => t.status === status),
    sort,
  );
}

function groupByStatus(
  tasks: Task[],
  sort: ProjectTaskSort = "custom",
): ItemsByColumn {
  return {
    todo: column(tasks, "todo", sort),
    doing: column(tasks, "doing", sort),
    done: column(tasks, "done", sort),
  };
}

/**
 * What the drag is currently over: whatever the pointer is inside, and only
 * proximity once it is inside nothing.
 *
 * The board used to score by closestCorners, which measures the dragged card's
 * corners rather than the pointer. A card is nearly as wide as a column, so in
 * flight it straddles two of them and the column it is merely passing over can
 * win on corner distance. Because the board moves cards between columns during
 * the drag, that column then took the card, put the card under the pointer,
 * and from there kept scoring closest to itself: dragging from Done to the top
 * of To do left the card sitting in Doing, the column in between.
 *
 * Letting the pointer decide is what stops it. Passing over a column is no
 * longer the same as aiming at it, and once the pointer moves on, the column
 * it left stops winning — the dragged card can only hold the drag while the
 * pointer is genuinely still on top of it, which is exactly when it should.
 *
 * Within a column a card beats the column that contains it — otherwise every
 * drop would be "somewhere in this column" and the position would be guesswork.
 *
 * It also records where the pointer is, because this is the only place dnd-kit
 * reports it. `onDragOver` gets rects and no cursor, and the dragged card's own
 * rect is not a substitute: re-sorting the list moves the card's layout slot,
 * so its rect lags behind the hand by however far the list has shuffled.
 */
function makeBoardCollisionDetection(
  pointer: React.RefObject<{ x: number; y: number } | null>,
): CollisionDetection {
  return (args) => {
    if (args.pointerCoordinates) pointer.current = args.pointerCoordinates;

    const typeOf = (id: UniqueIdentifier) =>
      args.droppableContainers.find((d) => d.id === id)?.data.current?.type;

    const underPointer = pointerWithin(args);

    const rail = underPointer.find((c) => typeOf(c.id) === "project-card");
    if (rail) return [rail];
    const card = underPointer.find((c) => typeOf(c.id) === "task");
    if (card) return [card];
    const col = underPointer.find((c) => typeOf(c.id) === "column");
    if (col) return [col];

    // Pointer outside every drop area — past the edge of the board, or on a
    // column's header. Nearest wins, but never a chip on proximity alone.
    return closestCorners({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        (d) => d.data.current?.type !== "project-card",
      ),
    });
  };
}

function findContainer(
  id: UniqueIdentifier,
  items: ItemsByColumn,
): ColumnId | undefined {
  if (id === "todo" || id === "doing" || id === "done") return id;
  return COLS.find((col) => items[col.key].some((t) => t.id === id))?.key;
}

type Props = {
  tasks: Task[];
  tags: Tag[];
  /** Open the in-place task editor (right panel). Card click + pencil. */
  onEditTask: (taskId: string) => void;
  /**
   * The project rail, rendered through a portal into `railHost` so it sits
   * above the board on the page while living inside this DndContext in the
   * React tree — which is what lets its cards act as drop targets. A drag and
   * the thing it lands on have to share one context.
   */
  rail?: React.ReactNode;
  railHost?: HTMLElement | null;
  /** Dropping a card on a project card in the rail. */
  onMoveToProject?: (taskId: string, projectId: string) => void;
  /** Multi-select across the columns. */
  selection?: SelectionController;
  /** How the columns are ordered. Defaults to the hand-made order. */
  sort?: ProjectTaskSort;
  /** A drag just arranged things by hand — the view's cue to flip to custom. */
  onArrange?: () => void;
};

export function KanbanBoard({
  tasks,
  tags,
  onEditTask,
  rail,
  railHost,
  onMoveToProject,
  selection,
  sort = "custom",
  onArrange,
}: Props) {
  const [, startTransition] = useTransition();
  const [items, setItems] = useState<ItemsByColumn>(() =>
    groupByStatus(tasks, sort),
  );
  // The same arrangement, readable synchronously. A drag fires many moves per
  // render, and each one has to build on the one before it rather than on
  // whatever React last painted.
  const itemsRef = useRef(items);
  const setBoard = (next: ItemsByColumn) => {
    itemsRef.current = next;
    setItems(next);
  };
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [dragReady, setDragReady] = useState(false);
  // After a drag, the browser still fires a click on the dropped card — swallow
  // it so finishing a drag never pops the editor open.
  const suppressClickRef = useRef(false);
  // The column the drag last placed the card in. See handleDragEnd.
  const landedRef = useRef<ColumnId | null>(null);
  // Where the cursor is, filled in by the collision detector.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  // Whether this drag actually rearranged anything, so a click-sized wobble
  // that ends where it started doesn't write a renumbering nobody asked for.
  const reorderedRef = useRef(false);
  const collisionDetection = useMemo(
    () => makeBoardCollisionDetection(pointerRef),
    [],
  );
  const { setDragActive } = useTagMenu();
  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  const handleCardClick = (taskId: string, e: React.MouseEvent) => {
    if (suppressClickRef.current) return;
    // ctrl/cmd and shift pick cards instead of opening them.
    if (selection?.onRowClick(taskId, e)) {
      window.getSelection?.()?.removeAllRanges();
      return;
    }
    onEditTask(taskId);
  };

  useEffect(() => {
    setDragReady(true);
  }, []);

  useEffect(() => {
    setBoard(groupByStatus(tasks, sort));
    // setBoard is a stable local wrapper around setState; listing it would
    // re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, sort]);

  // Mouse drags start after a tiny move; touch needs a long-press first so
  // plain swipes keep scrolling the board instead of grabbing cards.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 280, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const activeTask = useMemo(() => {
    if (!activeId) return null;
    for (const col of COLS) {
      const hit = items[col.key].find((t) => t.id === activeId);
      if (hit) return hit;
    }
    return null;
  }, [activeId, items]);

  const handleDragStart = (event: DragStartEvent) => {
    suppressClickRef.current = true;
    setDragActive(true);
    setActiveId(event.active.id);
    landedRef.current = findContainer(event.active.id, items) ?? null;
    reorderedRef.current = false;
  };

  const releaseClickSuppression = () => {
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 150);
  };

  /**
   * The card is placed on every pointer move, and the placement is the result.
   *
   * This hung off `onDragOver` and was the bug. dnd-kit fires that only when
   * the thing you are over CHANGES, so the position was decided the instant
   * the card entered a neighbour's band, from whichever half it entered
   * through, and sliding further up inside that same band never re-ran it: a
   * card dragged to the very top of a column stopped one slot short, every
   * time, and no amount of aiming fixed it. Across columns the same freeze put
   * the card wherever it happened to cross the border.
   *
   * `onDragMove` fires on the move itself, so the arrangement on screen when
   * you let go IS the answer, and the drop has nothing left to work out.
   */
  const handleDragMove = (event: DragMoveEvent) => {
    const { active, over } = event;
    // Over its own slot: it is already exactly where the pointer is asking for.
    if (!over || over.id === active.id) return;

    // Worked out from the ref, not from the `items` this handler closed over.
    // Several moves can arrive before React re-renders, and a handler reading
    // a render-old copy thinks the card is still in the column it left, finds
    // nothing to move, and drops the update — leaving the card wherever the
    // last surviving move happened to put it.
    const prev = itemsRef.current;
    const activeContainer = findContainer(active.id, prev);
    const overContainer = findContainer(over.id, prev);
    if (!activeContainer || !overContainer) return;
    landedRef.current = overContainer;

    const from = [...prev[activeContainer]];
    const activeIndex = from.findIndex((t) => t.id === active.id);
    if (activeIndex < 0) return;

    const sameColumn = activeContainer === overContainer;
    const [moved] = from.splice(activeIndex, 1);
    // Within one column, `from` (already minus the card) is the list being
    // inserted back into, so the indices line up either way.
    const to = sameColumn ? from : [...prev[overContainer]];
    const updated = sameColumn ? moved : { ...moved, status: overContainer };

    const insertAt = dropIndex({
      count: to.length,
      overIndex:
        over.id === overContainer ? -1 : to.findIndex((t) => t.id === over.id),
      pointerY: pointerRef.current?.y ?? over.rect.top,
      overTop: over.rect.top,
      overHeight: over.rect.height,
    });
    // Moving the pointer inside one slot is most of a drag. Do nothing when
    // nothing has actually moved, or every mouse move re-renders the board.
    if (sameColumn && insertAt === activeIndex) return;
    reorderedRef.current = true;

    to.splice(insertAt, 0, updated);
    setBoard(
      sameColumn
        ? { ...prev, [activeContainer]: to }
        : { ...prev, [activeContainer]: from, [overContainer]: to },
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setDragActive(false);
    releaseClickSuppression();
    if (!over) return;

    // Dropped on the rail: that's a change of project, not of status.
    const overData = over.data.current;
    if (overData?.type === "project-card") {
      const taskId = String(active.id);
      const target = String(overData.projectId);
      const original = tasks.find((t) => t.id === taskId);
      if (original && original.projectId !== target) {
        onMoveToProject?.(taskId, target);
      }
      // The card is leaving this board, so undo any column shuffling that the
      // drag did on the way over the rail.
      setBoard(groupByStatus(tasks, sort));
      return;
    }

    // Where the card ended up, recorded as the drag went rather than worked out
    // again here. Re-deriving the position from the final `over` was the second
    // half of the bug: it undid placements the drag had already made.
    const nextStatus = landedRef.current;
    if (!nextStatus) return;

    const taskId = String(active.id);
    const original = tasks.find((t) => t.id === taskId);
    if (!original) return;
    const from = original.status;
    if (from === nextStatus && !reorderedRef.current) return;
    reorderedRef.current = false;

    // A completed drag is an arrangement, whatever ordering was on screen —
    // what gets persisted below is exactly what the user is looking at, so
    // the view flips to custom and keeps showing it.
    onArrange?.();

    // Send the arrangement the drag ended on. Both columns go when the card
    // crossed between them: the one it left has a hole where it used to be.
    const current = itemsRef.current;
    startTransition(async () => {
      await moveTaskOnBoard({
        id: taskId,
        status: nextStatus,
        columnIds: current[nextStatus].map((t) => t.id),
        fromColumnIds:
          from === nextStatus ? undefined : current[from].map((t) => t.id),
      });
    });
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setDragActive(false);
    releaseClickSuppression();
    setBoard(groupByStatus(tasks, sort));
  };

  const columnBody = (col: (typeof COLS)[number]) => (
    <>
      {items[col.key].map((task) => (
        <KanbanCardShell
          key={task.id}
          task={task}
          tagMap={tagMap}
          onEdit={handleCardClick}
          selection={selection}
        />
      ))}
      {items[col.key].length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border2 px-4 py-8 text-center text-[11px] leading-relaxed text-faint">
          {col.key === "todo"
            ? "Nothing to do. Capture a task with +"
            : col.key === "doing"
              ? "Long-press a card and drag it here"
              : "Finished tasks land here"}
        </div>
      ) : null}
    </>
  );

  const railPortal = rail && railHost ? createPortal(rail, railHost) : null;

  if (!dragReady) {
    return (
      <>
        {railPortal}
        <div className="h-full min-h-0 flex-1 gap-3.5 max-lg:flex max-lg:snap-x max-lg:snap-mandatory max-lg:gap-3 max-lg:overflow-x-auto max-lg:overscroll-x-contain max-lg:scroll-px-3 lg:grid lg:grid-cols-3">
          {COLS.map((col) => (
            <KanbanColumnStatic
              key={col.key}
              label={col.label}
              color={col.color}
              count={items[col.key].length}
            >
              {columnBody(col)}
            </KanbanColumnStatic>
          ))}
        </div>
      </>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {railPortal}
      <div className="h-full min-h-0 flex-1 gap-3.5 max-lg:flex max-lg:snap-x max-lg:snap-mandatory max-lg:gap-3 max-lg:overflow-x-auto max-lg:overscroll-x-contain max-lg:scroll-px-3 lg:grid lg:grid-cols-3">
        {COLS.map((col) => (
          <KanbanColumn
            key={col.key}
            id={col.key}
            label={col.label}
            color={col.color}
            count={items[col.key].length}
            isDragging={activeId !== null}
          >
            <SortableContext
              items={items[col.key].map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {items[col.key].map((task) => (
                <KanbanCard
                  key={task.id}
                  task={task}
                  tagMap={tagMap}
                  onEdit={handleCardClick}
                  selection={selection}
                />
              ))}
              {items[col.key].length === 0 ? (
                <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border2 px-4 py-8 text-center text-[11px] leading-relaxed text-faint">
                  {col.key === "todo"
                    ? "Nothing to do. Capture a task with +"
                    : col.key === "doing"
                      ? "Long-press a card and drag it here"
                      : "Finished tasks land here"}
                </div>
              ) : null}
            </SortableContext>
          </KanbanColumn>
        ))}
      </div>

      <DragOverlay dropAnimation={dropAnimation}>
        {activeTask ? (
          <KanbanCardShell task={activeTask} tagMap={tagMap} overlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

const dropAnimation = {
  duration: 220,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
};

function KanbanColumnStatic({
  label,
  color,
  count,
  children,
}: {
  label: string;
  color: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="kanban-column flex min-h-0 flex-col rounded-xl border border-border bg-surface2 p-3 max-lg:w-[76vw] md:max-lg:w-[44vw] max-lg:max-w-[360px] max-lg:shrink-0 max-lg:snap-center">
      <div className="mb-2.5 flex items-center gap-1.5 px-0.5">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-[12.5px] font-bold">{label}</span>
        <span className="font-mono text-[10px] text-faint">{count}</span>
      </div>
      <div className="glow-room flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-3.5">
        {children}
      </div>
    </div>
  );
}

function KanbanColumn({
  id,
  label,
  color,
  count,
  isDragging,
  children,
}: {
  id: ColumnId;
  label: string;
  color: string;
  count: number;
  isDragging: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: "column" } });

  return (
    <div
      className={cn(
        "kanban-column flex min-h-0 flex-col rounded-xl border p-3 transition-all duration-200 ease-out max-lg:w-[76vw] md:max-lg:w-[44vw] max-lg:max-w-[360px] max-lg:shrink-0 max-lg:snap-center",
        isOver
          ? "kanban-column--over border-primary/40 bg-primary/[0.04] shadow-[inset_0_0_0_1px_oklch(0.55_0.16_274/0.15)]"
          : "border-border bg-surface2",
        isDragging && !isOver && "opacity-95",
      )}
    >
      <div className="mb-2.5 flex items-center gap-1.5 px-0.5">
        <span
          className="h-2 w-2 rounded-full transition-transform duration-200"
          style={{
            background: color,
            transform: isOver ? "scale(1.25)" : undefined,
          }}
        />
        <span className="text-[12.5px] font-bold">{label}</span>
        <span className="font-mono text-[10px] text-faint">{count}</span>
      </div>
      {/* The drop area is the cards, not the whole column. With the header
          inside it, the column itself was what the pointer was over when you
          aimed at the top of the list, and "over the column" means "put it
          last" — so the top of a column was the one place you could not drop
          something. Starting at the first card, aiming high hits that card. */}
      <div
        ref={setNodeRef}
        className="glow-room flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-3.5"
      >
        {children}
      </div>
    </div>
  );
}

function KanbanCard({
  task,
  tagMap,
  onEdit,
  selection,
}: {
  task: Task;
  tagMap: Map<string, Tag>;
  onEdit: (taskId: string, e: React.MouseEvent) => void;
  selection?: SelectionController;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { type: "task", status: task.status } });

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
    >
      <KanbanCardShell
        task={task}
        tagMap={tagMap}
        onEdit={onEdit}
        selection={selection}
      />
    </div>
  );
}

function KanbanCardShell({
  task,
  tagMap,
  onEdit,
  overlay = false,
  selection,
}: {
  task: Task;
  tagMap: Map<string, Tag>;
  onEdit?: (taskId: string, e: React.MouseEvent) => void;
  overlay?: boolean;
  selection?: SelectionController;
}) {
  const { open } = useTagMenu();
  const picked = Boolean(selection?.isSelected(task.id));
  return (
    <div
      onClick={overlay ? undefined : (e) => onEdit?.(task.id, e)}
      onMouseDownCapture={selection ? suppressRangeTextSelection : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        open({
          entity: "task",
          id: task.id,
          tagIds: task.tagIds,
          lifeArea: task.lifeArea,
          x: e.clientX,
          y: e.clientY,
          selection: selection
            ? {
                selected: picked,
                active: selection.active,
                onToggle: () => selection.toggle(task.id),
                onThrough: () => selection.selectThrough(task.id),
              }
            : undefined,
        });
      }}
      className={cn(
        "rounded-lg border bg-surface p-[10px_11px]",
        picked
          ? "border-primary bg-primary/[0.08] ring-1 ring-inset ring-primary/40"
          : "border-border",
        overlay
          ? "kanban-card--overlay rotate-[1.5deg] cursor-grabbing"
          : "cursor-pointer hover:border-faint2 hover:shadow-sm",
      )}
    >
      <div className="mb-2 flex items-start gap-1.5">
        {selection?.active && !overlay && (
          <button
            type="button"
            aria-pressed={picked}
            aria-label={
              picked ? `Deselect ${task.title}` : `Select ${task.title}`
            }
            onClick={(e) => {
              e.stopPropagation();
              selection.toggle(task.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              "mt-px flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border-[1.8px] transition-colors",
              picked
                ? "border-primary bg-primary"
                : "border-faint2 hover:border-primary",
            )}
          >
            {picked && (
              <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.4} />
            )}
          </button>
        )}
        <div className="min-w-0 flex-1 text-[13px] font-medium leading-snug">
          {task.title}
        </div>
        {!overlay && (
          <button
            type="button"
            title="Edit task"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
            onClick={(e) => {
              e.stopPropagation();
              onEdit?.(task.id, e);
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <TaskTimer task={task} compact stopPropagation />
        {task.tagIds.map((id) => {
          const tg = tagMap.get(id);
          if (!tg) return null;
          return (
            <span
              key={id}
              className="rounded px-1.5 py-px font-mono text-[9px]"
              style={{ color: tg.color, background: tagBg(tg.color) }}
            >
              {tg.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}
