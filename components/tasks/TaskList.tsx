"use client";

import Link from "next/link";
import { useLayoutEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "@/components/icons";
import type { Task, Tag } from "@/lib/schemas";
import {
  suppressRangeTextSelection,
  type SelectionController,
} from "@/lib/use-task-selection";
import { dueDatePart } from "@/lib/date";
import {
  toggleTask,
  cycleTaskPriority,
  deleteTaskAction,
} from "@/lib/actions/tasks";
import { Taggable } from "@/components/tags/TagMenuProvider";
import { TaskTimer } from "@/components/tasks/TaskTimer";
import { DeleteButton } from "@/components/ui/delete-button";
import { useDraggable } from "@dnd-kit/core";
import { PriorityChip } from "@/components/tasks/PriorityChip";
import { budgetForWidth, fitTagLine } from "@/lib/tag-line";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { taskDetailHref } from "@/lib/task-links";
import type { LifeView } from "@/lib/life-area";
import { iso } from "@/lib/date";
import { useTimezone } from "@/components/shell/TimeZoneProvider";
import {
  CALENDAR_PRIO,
  calendarPrioBg,
  isMeetingPast,
  isMeetingTask,
  meetingTimeLabel,
  sortCalendarDayTasks,
} from "@/lib/calendar-tasks";

// Widget rows keep the bar as hover garnish — the HIGH/MID/LOW chip states the
// priority outright now, so a permanent stripe on every row was just noise.
const PRIO_BORDER = {
  high: "border-l-[oklch(0.64_0.18_25)]",
  med: "border-l-[oklch(0.7_0.12_70)]",
  low: "border-l-faint2/40",
} as const;

type Props = {
  tasks: Task[];
  tags: Tag[];
  showDelete?: boolean;
  dueField?: "short" | "full";
  linkRowsTo?: string;
  linkTaskDetail?: boolean;
  lifeView?: LifeView;
  variant?: "default" | "page" | "calendar";
  calendarDay?: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Let rows be dragged into another project group. Requires a DndContext. */
  draggableTasks?: boolean;
  /** Multi-select. Rows show a checkbox and honour ctrl/shift once wired. */
  selection?: SelectionController;
};

/**
 * Wraps a row so it can be picked up and dropped on a project group. Kept as
 * its own component because the hook has to run per row, and left out entirely
 * when dragging is off so lists that don't need it pay nothing.
 */
function DraggableRow({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { type: "task" },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "cursor-grab touch-manipulation active:cursor-grabbing",
        isDragging && "opacity-35",
      )}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

const STATUS_STYLE = {
  todo: "border-border bg-surface2 text-faint",
  doing: "border-primary/40 bg-primary/10 text-primary",
  done: "border-habits/40 bg-habits/10 text-habits",
} as const;

function SubtaskProgress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mt-1 flex items-center gap-2">
      <div className="h-1 max-w-[100px] flex-1 overflow-hidden rounded-full bg-border2">
        <div
          className="h-full rounded-full bg-habits transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-[9px] tabular-nums text-faint2">
        {done}/{total}
      </span>
    </div>
  );
}

/**
 * The tags, on their own line under the title.
 *
 * They used to sit inline after the title, which meant a long title pushed
 * them off the row entirely — the common case, since titles are usually
 * longer than the space left over.
 *
 * The hash is faint and the name carries the tag's colour. Colouring the hash
 * too repeats the same signal once per tag, and at four tags that is four
 * coloured glyphs saying nothing the names do not already say.
 *
 * One line, never two. A task with six tags would otherwise be twice the
 * height of its neighbours, and a long list where some rows are double-height
 * reads as broken rather than as informative.
 *
 * The width is measured rather than assumed. Fixed per-layout budgets were
 * the first attempt and they were wrong: this same list renders with the
 * detail panel open, where the fixed grid tracks leave the title cell about
 * 73 pixels, and inside dashboard cards, and full width — a range no set of
 * tiers covers. One ResizeObserver per row sounded expensive until the
 * alternative turned out to be silently clipping the common case.
 */
function TagLine({ tags }: { tags: Tag[] }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [budget, setBudget] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBudget(budgetForWidth(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (tags.length === 0) return null;

  // Before the first measurement there is no honest answer, so the line
  // renders empty at its full height rather than flashing every tag and
  // snapping back to two. One frame, and only on mount.
  const { shown, hidden } =
    budget === null ? { shown: [], hidden: 0 } : fitTagLine(tags, budget);

  return (
    <span
      ref={ref}
      className="mt-0.5 flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden font-mono text-[11px] leading-[1.4]"
    >
      {shown.map((tg) => (
        <span key={tg.id} className="shrink-0 whitespace-nowrap">
          <span className="text-faint2">#</span>
          <span style={{ color: tg.color }}>{tg.name}</span>
        </span>
      ))}
      {hidden > 0 && (
        <span
          className="shrink-0 text-faint2"
          title={tags
            .slice(shown.length)
            .map((tg) => `#${tg.name}`)
            .join(" ")}
        >
          +{hidden}
        </span>
      )}
    </span>
  );
}

export function TaskList({
  tasks,
  tags,
  showDelete = false,
  dueField = "short",
  linkRowsTo,
  linkTaskDetail = false,
  lifeView,
  variant = "default",
  calendarDay,
  selectedId,
  onSelect,
  draggableTasks = false,
  selection,
}: Props) {
  const router = useRouter();
  const [optimistic, setOptimistic] = useOptimistic(tasks);
  const [, startTransition] = useTransition();

  const tagMap = new Map(tags.map((t) => [t.id, t]));
  const isPage = variant === "page";
  const isCalendar = variant === "calendar";
  const compact = isPage && Boolean(onSelect);
  const timeZone = useTimezone();
  const today = iso(new Date(), timeZone);
  const day = calendarDay ?? today;

  const listed = isCalendar ? sortCalendarDayTasks(optimistic) : optimistic;

  const handleToggle = (id: string) => {
    startTransition(async () => {
      setOptimistic(
        optimistic.map((t) =>
          t.id === id
            ? {
                ...t,
                status: t.status === "done" ? "todo" : "done",
              }
            : t,
        ),
      );
      // The action's revalidatePath already re-renders the current route in the
      // same response, so no explicit router.refresh() round-trip is needed.
      await toggleTask(id);
    });
  };

  const PRIO_NEXT = { low: "med", med: "high", high: "low" } as const;
  const handlePrio = (id: string) => {
    startTransition(async () => {
      setOptimistic(
        optimistic.map((t) =>
          t.id === id ? { ...t, priority: PRIO_NEXT[t.priority] } : t,
        ),
      );
      await cycleTaskPriority(id);
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      setOptimistic(optimistic.filter((t) => t.id !== id));
      const res = await deleteTaskAction(id);
      if (res.ok) {
        toast.success("Task deleted", {
          action: res.undo
            ? {
                label: "UNDO",
                onClick: () => router.refresh(),
              }
            : undefined,
        });
      }
      // deleteTaskAction revalidates the route; no extra refresh needed.
    });
  };

  return (
    <div
      className={cn("flex flex-col", isPage || isCalendar ? "gap-1" : "gap-px")}
      // Capture, so it lands before any row's own handler and covers the
      // whole list including whatever child the click actually hit.
      onMouseDownCapture={selection ? suppressRangeTextSelection : undefined}
    >
      {listed.map((t) => {
        const done = t.status === "done";
        const taskTags = t.tagIds
          .map((id) => tagMap.get(id))
          .filter(Boolean) as Tag[];
        const due =
          dueField === "full"
            ? dueDatePart(t.due)
            : t.due?.includes("T")
              ? t.due.split("T")[1]
              : dueDatePart(t.due);

        const selected = selectedId === t.id;
        const picked = Boolean(selection?.isSelected(t.id));
        // Position within the selection, top to bottom. Shown instead of a
        // check: it doubles as the running count, and a number cannot be
        // mistaken for the completion control.
        const pickedAt = picked ? (selection?.ids.indexOf(t.id) ?? -1) + 1 : 0;
        const subtaskDone = t.subtasks.filter((s) => s.done).length;
        const subtaskTotal = t.subtasks.length;

        const titleClass = cn(
          compact ? "text-[15px] font-semibold leading-snug" : "text-sm",
          "truncate",
          done ? "text-faint2 line-through" : "text-ink",
        );

        if (isCalendar && isMeetingTask(t) && t.due) {
          const past = isMeetingPast(t.due, day, new Date(), timeZone);
          const color = CALENDAR_PRIO[t.priority];
          const detailHref =
            linkTaskDetail && lifeView
              ? taskDetailHref(t, lifeView, today)
              : null;
          return (
            <Taggable
              key={t.id}
              entity="task"
              id={t.id}
              tagIds={t.tagIds}
              lifeArea={t.lifeArea}
              className="flex gap-2 rounded-lg px-1 py-1.5 hover:bg-surface2"
            >
              <span className="w-10 shrink-0 pt-px font-mono text-[11px] tabular-nums text-faint2">
                {meetingTimeLabel(t.due)}
              </span>
              <div
                className="min-w-0 flex-1 rounded-r-md border-l-2 py-0.5 pl-2"
                style={{
                  borderColor: color,
                  background: calendarPrioBg(color),
                }}
              >
                {detailHref ? (
                  <Link
                    href={detailHref}
                    className={cn(
                      "block min-w-0 truncate text-[13px] font-medium hover:underline",
                      past ? "text-faint line-through" : "text-ink",
                    )}
                  >
                    {t.title}
                  </Link>
                ) : (
                  <span
                    className={cn(
                      "block truncate text-[13px] font-medium",
                      past ? "text-faint line-through" : "text-ink",
                    )}
                  >
                    {t.title}
                  </span>
                )}
              </div>
            </Taggable>
          );
        }

        if (isCalendar) {
          const detailHref =
            linkTaskDetail && lifeView
              ? taskDetailHref(t, lifeView, today)
              : null;
          return (
            <Taggable
              key={t.id}
              entity="task"
              id={t.id}
              tagIds={t.tagIds}
              lifeArea={t.lifeArea}
              className="flex items-center gap-2.5 rounded-lg px-1.5 py-2 hover:bg-surface2"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggle(t.id);
                }}
                className={cn(
                  "flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] border-[1.8px]",
                  done
                    ? "border-none bg-habits"
                    : "border-border bg-transparent",
                )}
              >
                {done && (
                  <Check
                    className="h-[11px] w-[11px] animate-pumma-pop text-white"
                    strokeWidth={3.2}
                  />
                )}
              </button>
              <PriorityChip
                priority={t.priority}
                onCycle={() => handlePrio(t.id)}
                dimmed={done}
              />
              {detailHref ? (
                <Link
                  href={detailHref}
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13px] hover:underline",
                    done ? "text-faint2 line-through" : "text-ink",
                  )}
                >
                  {t.title}
                </Link>
              ) : (
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[13px]",
                    done ? "text-faint2 line-through" : "text-ink",
                  )}
                >
                  {t.title}
                </span>
              )}
            </Taggable>
          );
        }

        const accentBorder = isPage
          ? t.status === "doing"
            ? "border-l-[3px] border-l-primary"
            : `border-l-[3px] ${PRIO_BORDER[t.priority]}`
          : "";

        // Spotlight selection: while anything is selected, the rows NOT in the
        // selection step back — dimmed and desaturated — and the selected ones
        // keep full colour plus the primary wash. The signal is the contrast
        // of the whole list, not a mark to hunt for on each row. One opacity
        // for both themes: a per-theme value needed the `dark` variant, which
        // is scoped to a data attribute here and did not behave as written,
        // and 0.40 against 0.45 is a difference nobody can see.
        const dimmed = Boolean(selection?.active) && !picked;

        const rowClass = cn(
          "task-row grid items-center transition-[opacity,background-color] duration-150",
          compact
            ? cn(
                "cursor-pointer gap-x-2.5 border-b border-border2 px-3 py-2.5 last:border-b-0",
                showDelete
                  ? "grid-cols-[20px_34px_minmax(0,1fr)_72px_28px] max-sm:grid-cols-[20px_18px_minmax(0,1fr)_46px_24px]"
                  : "grid-cols-[20px_34px_minmax(0,1fr)_72px] max-sm:grid-cols-[20px_18px_minmax(0,1fr)_46px]",
                picked
                  ? "border-l-[3px] border-l-primary bg-primary/[0.14]"
                  : selected
                    ? "border-l-[3px] border-l-tasks bg-tasks/[0.12] ring-1 ring-inset ring-tasks/35"
                    : cn("hover:bg-hover", accentBorder),
                dimmed && "opacity-45 saturate-50",
              )
            : cn(
                "gap-x-[11px]",
                isPage
                  ? "border-b border-border2 px-4 py-2.5 last:border-b-0 hover:bg-hover"
                  : "rounded-lg px-1.5 py-1 transition-colors duration-150 hover:bg-hover",
                showDelete
                  ? "grid-cols-[18px_34px_minmax(0,1fr)_92px_52px_16px] max-sm:grid-cols-[18px_18px_minmax(0,1fr)_0px_44px_16px]"
                  : "grid-cols-[18px_34px_minmax(0,1fr)_92px_52px] max-sm:grid-cols-[18px_18px_minmax(0,1fr)_0px_44px]",
                isPage && t.status === "doing" && "bg-primary/[0.03]",
                picked && "border-l-[3px] border-l-primary bg-primary/[0.14]",
                !picked &&
                  selected &&
                  "border-l-[3px] border-l-tasks bg-tasks/[0.12] ring-1 ring-inset ring-tasks/35",
                !picked && !selected && accentBorder,
                dimmed && "opacity-45 saturate-50",
              ),
        );

        const openDetail = () => onSelect?.(t.id);

        // ctrl/cmd and shift are selection gestures; anything else is the
        // ordinary click that opens the task — until a selection is live.
        // Then a plain click toggles membership instead, the way a mail
        // client's list works once something is checked: the list is in
        // "holding things" mode, and Escape or emptying the selection is the
        // way out. Without this, the only route into the selection was a
        // modifier key, which a phone does not have.
        const handleRowClick = (e: React.MouseEvent) => {
          if (
            selection?.active &&
            !e.metaKey &&
            !e.ctrlKey &&
            !e.shiftKey
          ) {
            selection.toggle(t.id);
            return;
          }
          if (selection?.onRowClick(t.id, e)) {
            // Stop the browser turning a shift-click into a text selection
            // across half the list.
            window.getSelection?.()?.removeAllRanges();
            return;
          }
          openDetail();
        };

        const rowHref =
          linkTaskDetail && lifeView
            ? taskDetailHref(t, lifeView, today)
            : linkRowsTo;

        const row = (
          <Taggable
            key={draggableTasks ? undefined : t.id}
            entity="task"
            id={t.id}
            tagIds={t.tagIds}
            lifeArea={t.lifeArea}
            className={rowClass}
            onClick={compact || selection ? handleRowClick : undefined}
            selection={
              selection
                ? {
                    selected: picked,
                    active: selection.active,
                    onToggle: () => selection.toggle(t.id),
                    onThrough: () => selection.selectThrough(t.id),
                  }
                : undefined
            }
          >
            {/* One control, one meaning: this completes the task, selection
                live or not. It used to swap into a selection toggle the moment
                anything was selected — same square, new behaviour, and a done
                task's tick silently became a dash. The confusion was the swap
                itself, so there is no second form any more; rows are selected
                by clicking the row. */}
            {(
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggle(t.id);
                }}
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-[5px] border-[1.8px]",
                  isPage
                    ? "h-5 w-5 max-lg:h-6 max-lg:w-6"
                    : "h-[18px] w-[18px] max-lg:h-5 max-lg:w-5",
                  done
                    ? "border-none bg-habits"
                    : "border-border bg-transparent",
                )}
              >
                {done && (
                  <Check
                    className="h-[11px] w-[11px] animate-pumma-pop text-white"
                    strokeWidth={3.2}
                  />
                )}
              </button>
            )}

            <PriorityChip
              priority={t.priority}
              onCycle={() => handlePrio(t.id)}
              dimmed={done}
              className="justify-self-start"
            />

            <div
              className={cn(
                "min-w-0",
                !compact && "flex min-w-0 items-center gap-1.5 overflow-hidden",
                !compact && onSelect && "cursor-pointer",
                // Room for the badge, which is absolutely placed so it sits at
                // the same spot whether the cell is a flex row (page rows) or
                // a stack (compact rows).
                picked && "relative pr-5",
              )}
              onClick={
                !compact && onSelect
                  ? (e) => {
                      e.stopPropagation();
                      handleRowClick(e);
                    }
                  : undefined
              }
              onKeyDown={
                !compact && onSelect
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openDetail();
                      }
                    }
                  : undefined
              }
              role={!compact && onSelect ? "button" : undefined}
              tabIndex={!compact && onSelect ? 0 : undefined}
            >
              {!compact && isPage && (
                <span
                  className={cn(
                    "shrink-0 rounded-md border px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wide",
                    STATUS_STYLE[t.status],
                  )}
                >
                  {t.status}
                </span>
              )}
              {rowHref ? (
                <Link
                  href={rowHref}
                  className="flex min-w-0 flex-1 flex-col justify-center gap-0 overflow-hidden no-underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden">
                    <span
                      className={cn(
                        titleClass,
                        "min-w-0 flex-1 truncate hover:underline",
                      )}
                    >
                      {t.title}
                    </span>
                    {!compact && subtaskTotal > 0 && (
                      <span className="task-subcount-inline shrink-0 font-mono text-[9px] text-faint2">
                        {subtaskDone}/{subtaskTotal}
                      </span>
                    )}
                  </span>
                  <TagLine tags={taskTags} />
                </Link>
              ) : (
                <>
                  <span className={cn(titleClass, "block truncate")}>
                    {t.title}
                  </span>
                  {compact && subtaskTotal > 0 && (
                    <SubtaskProgress done={subtaskDone} total={subtaskTotal} />
                  )}
                  <TagLine tags={taskTags} />
                </>
              )}
              {pickedAt > 0 && (
                <span
                  aria-label={`Selected, ${pickedAt} of ${selection?.ids.length}`}
                  className="absolute right-0 top-1/2 -translate-y-1/2 font-mono text-[11px] font-bold tabular-nums text-primary"
                >
                  {pickedAt}
                </span>
              )}
            </div>

            {compact ? (
              <div
                className="flex flex-col items-end justify-center gap-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                {/* The stopwatch is a desk feature. On a phone it costs the
                    title a third of its width, so below sm only the date
                    stays and the row becomes one line. */}
                <span className="max-sm:hidden">
                  <TaskTimer
                    task={t}
                    compact
                    stopPropagation={Boolean(rowHref || onSelect)}
                  />
                </span>
                <span className="font-mono text-[10px] tabular-nums text-faint">
                  {due}
                </span>
              </div>
            ) : (
              <>
                <div
                  className="task-timer-cell flex items-center justify-end gap-1.5 max-sm:hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  <TaskTimer
                    task={t}
                    compact
                    stopPropagation={Boolean(rowHref || onSelect)}
                  />
                </div>
                <span
                  className={cn(
                    "text-right font-mono tabular-nums text-faint",
                    isPage ? "text-[11px]" : "text-[10px]",
                  )}
                >
                  {due}
                </span>
              </>
            )}

            {showDelete && (
              <DeleteButton
                onClick={() => handleDelete(t.id)}
                label={`Delete task ${t.title}`}
                size={isPage ? "md" : "sm"}
              />
            )}
          </Taggable>
        );

        return draggableTasks ? (
          <DraggableRow key={t.id} id={t.id}>
            {row}
          </DraggableRow>
        ) : (
          row
        );
      })}
    </div>
  );
}
