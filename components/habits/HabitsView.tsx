"use client";
import { DeleteButton } from "@/components/ui/delete-button";
import { EntityTagRow } from "@/components/tags/EntityTagRow";

import {
  useEffect,
  useMemo,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryState } from "nuqs";
import { Check } from "@/components/icons";
import { toast } from "sonner";
import type { Goal, Habit, HabitEntry, Tag } from "@/lib/schemas";
import { iso, type WeekStart } from "@/lib/date";
import {
  toggleHabitPeriod,
  archiveHabit,
  deleteHabitAction,
  renameHabit,
  updateHabitFrequencyAction,
  updateHabitsOrderAction,
} from "@/lib/actions/habits";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { attachHabitToGoal, detachHabitFromGoal } from "@/lib/actions/links";
import { Topbar } from "@/components/shell/Topbar";
import { GoalMultiLinkField } from "@/components/links/GoalLinkField";
import { HabitHeatStrip } from "@/components/habits/HabitHeatStrip";
import { HabitDayPicker } from "@/components/habits/HabitDayPicker";
import {
  habitFrequencyLabel,
  currentHabitPeriod,
  habitBestStreak,
  habitStreak,
  normalizeHabitFrequency,
  type HabitFrequencyType,
  type HabitVisibilitySettings,
} from "@/lib/habit-visibility";
import { Switch } from "@/components/ui/switch";
import { EditableTitle } from "@/components/ui/editable-title";
import { cn } from "@/lib/utils";
import { useTimezone } from "@/components/shell/TimeZoneProvider";

type Props = {
  habits: Habit[];
  habitEntries: HabitEntry[];
  goals: Goal[];
  tags: Tag[];
  stats: { dayPct: number; habitsLabel: string; topStreak: number };
  habitVisibility: HabitVisibilitySettings;
  weekStart: WeekStart;
  birthDate?: string | null;
  lifeSpanYears?: number;
};

export function HabitsView({
  habits,
  habitEntries,
  goals,
  tags,
  stats,
  habitVisibility,
  weekStart,
  birthDate = null,
  lifeSpanYears,
}: Props) {
  const [pending, startTransition] = useTransition();

  // The dragged order is held locally so a drop lands on the frame it
  // happens, and the server write follows. Reset whenever the server sends a
  // different set — a habit added or deleted elsewhere must not be dropped
  // by a stale local list.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  useEffect(() => setDragOrder(null), [habits]);
  const ordered = useMemo(() => {
    if (!dragOrder) return habits;
    const byId = new Map(habits.map((h) => [h.id, h]));
    const moved = dragOrder
      .map((id) => byId.get(id))
      .filter(Boolean) as typeof habits;
    // Anything the local order does not know about keeps its server place.
    return moved.length === habits.length ? moved : habits;
  }, [habits, dragOrder]);

  const sensors = useSensors(
    // 6px before a drag starts, so clicking a checkbox inside a card is
    // still a click.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 280, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = ordered.map((h) => h.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    setDragOrder(next);
    startTransition(async () => {
      const res = await updateHabitsOrderAction(next);
      if (!res.ok) {
        setDragOrder(null);
        toast.error(res.error ?? "Could not save the new order");
      }
    });
  };
  const [habitId] = useQueryState("habit");
  const timeZone = useTimezone();
  const confirm = useConfirm();

  const handleDelete = async (h: Habit, entryCount: number) => {
    const ok = await confirm({
      title: `Delete "${h.name}"?`,
      description:
        entryCount > 0
          ? `This permanently removes the habit and its ${entryCount} logged ${entryCount === 1 ? "day" : "days"}. To keep the history, archive it instead.`
          : "This permanently removes the habit. To keep it around, archive it instead.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteHabitAction(h.id);
      if (!res.ok) toast.error(res.error ?? "Could not delete habit");
      else toast.success("Habit deleted");
    });
  };
  const td = iso(new Date(), timeZone);

  // Optimistic entries: the checkbox / heat cell / streaks update instantly,
  // then reconcile when the server action + revalidation returns.
  // Mirrors the server rule: a period reads as done when ANY entry falls in it,
  // so undoing clears the whole range rather than a single date.
  const [optimisticEntries, applyToggle] = useOptimistic(
    habitEntries,
    (
      state: HabitEntry[],
      t: { habitId: string; start: string; end: string; markDate: string },
    ) => {
      const inRange = (e: HabitEntry) =>
        e.habitId === t.habitId && e.date >= t.start && e.date <= t.end;
      return state.some(inRange)
        ? state.filter((e) => !inRange(e))
        : [
            ...state,
            {
              id: `optimistic:${t.habitId}:${t.markDate}`,
              userId: "optimistic",
              habitId: t.habitId,
              date: t.markDate,
              done: true,
            },
          ];
    },
  );

  const entriesFor = (id: string) =>
    new Set(
      optimisticEntries.filter((e) => e.habitId === id).map((e) => e.date),
    );

  const togglePeriod = (
    id: string,
    period: { start: string; end: string; markDate: string },
  ) =>
    startTransition(async () => {
      applyToggle({ habitId: id, ...period });
      await toggleHabitPeriod({ habitId: id, ...period });
    });

  useEffect(() => {
    if (!habitId) return;
    document
      .getElementById(`habit-${habitId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [habitId, habits]);

  return (
    <>
      <Topbar
        title="Habits"
        dayPct={stats.dayPct}
        habitsLabel={stats.habitsLabel}
        topStreak={stats.topStreak}
        birthDate={birthDate}
        lifeSpanYears={lifeSpanYears}
      />
      <div className="glow-room min-h-0 flex-1 overflow-y-auto pb-6 max-lg:pb-28 animate-pumma-view">
        <div className="mb-4 flex items-center gap-3">
          <span className="font-mono text-[11px] text-faint">
            {stats.habitsLabel} done today · best streak {stats.topStreak}🔥
          </span>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={ordered.map((h) => h.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {ordered.map((h) => {
                const set = entriesFor(h.id);
                const frequency = normalizeHabitFrequency(h.frequency.type);
                // The checkbox reflects the habit's OWN period, not just today —
                // for a weekly habit, "done" means done somewhere this week.
                const period = currentHabitPeriod(
                  frequency,
                  weekStart,
                  td,
                  timeZone,
                );
                const doneToday = [...set].some(
                  (d) => d >= period.start && d <= period.end,
                );
                const linkedGoals = goals.filter((g) =>
                  h.goalIds.includes(g.id),
                );
                const availableGoals = goals.filter(
                  (g) => !h.goalIds.includes(g.id),
                );
                return (
                  <SortableHabitCard
                    key={h.id}
                    id={h.id}
                    className={cn(
                      "flex min-h-[168px] flex-col gap-3 rounded-[13px] border border-border bg-surface p-4 hover:border-faint2",
                      h.archived && "opacity-45",
                      habitId === h.id && "ring-2 ring-habits/35",
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          togglePeriod(h.id, { ...period, markDate: td })
                        }
                        className={cn(
                          "mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border-2",
                          doneToday ? "border-none bg-habits" : "border-border",
                        )}
                      >
                        {doneToday && (
                          <Check
                            className="h-[13px] w-[13px] text-white"
                            strokeWidth={3.2}
                          />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <HabitName
                            name={h.name}
                            onRename={(next) =>
                              startTransition(async () => {
                                const res = await renameHabit(h.id, next);
                                if (!res.ok)
                                  toast.error(res.error ?? "Rename failed");
                              })
                            }
                          />
                          <select
                            className="shrink-0 rounded-md border border-border bg-surface px-2 py-1 font-mono text-[10px] text-muted outline-none focus:border-faint"
                            value={frequency}
                            onChange={(e) =>
                              startTransition(async () => {
                                await updateHabitFrequencyAction(h.id, {
                                  type: e.target.value as HabitFrequencyType,
                                });
                              })
                            }
                          >
                            <option value="daily">
                              {habitFrequencyLabel("daily")}
                            </option>
                            <option value="weekly">
                              {habitFrequencyLabel("weekly")}
                            </option>
                            <option value="monthly">
                              {habitFrequencyLabel("monthly")}
                            </option>
                          </select>
                        </div>
                        {frequency === "daily" && (
                          <div className="mt-2">
                            <HabitDayPicker
                              days={h.frequency.days}
                              weekStart={weekStart}
                              disabled={pending}
                              onChange={(days) =>
                                startTransition(async () => {
                                  const res = await updateHabitFrequencyAction(
                                    h.id,
                                    {
                                      type: "daily",
                                      days,
                                    },
                                  );
                                  if (!res.ok) {
                                    toast.error(
                                      res.error ?? "Could not save days",
                                    );
                                  }
                                })
                              }
                            />
                          </div>
                        )}
                        <div className="mt-2">
                          <GoalMultiLinkField
                            label="Goals"
                            items={linkedGoals.map((g) => ({
                              id: g.id,
                              title: g.title,
                            }))}
                            available={availableGoals.map((g) => ({
                              id: g.id,
                              title: g.title,
                            }))}
                            dotShape="diamond"
                            onAttach={(goalId) =>
                              startTransition(async () => {
                                await attachHabitToGoal(h.id, goalId);
                              })
                            }
                            onDetach={(goalId) =>
                              startTransition(async () => {
                                await detachHabitFromGoal(h.id, goalId);
                              })
                            }
                          />
                        </div>
                        <div className="mt-2">
                          <EntityTagRow
                            entity="habit"
                            entityId={h.id}
                            tags={tags}
                            selectedTagIds={h.tagIds}
                          />
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-center gap-1">
                        <Switch
                          checked={!h.archived}
                          onCheckedChange={(active) => {
                            if (active === !h.archived) return;
                            startTransition(async () => {
                              await archiveHabit(h.id);
                            });
                          }}
                          aria-label={
                            h.archived ? "Enable habit" : "Disable habit"
                          }
                        />
                        <span className="font-mono text-[9px] text-faint">
                          {h.archived ? "off" : "on"}
                        </span>
                        <DeleteButton
                          onClick={() => handleDelete(h, set.size)}
                          label={`Delete habit ${h.name}`}
                          className="mt-0.5"
                        />
                      </div>
                    </div>

                    <HabitHeatStrip
                      habit={h}
                      entries={set}
                      visibility={habitVisibility}
                      weekStart={weekStart}
                      onToggleCell={(cell) =>
                        togglePeriod(h.id, {
                          start: cell.periodStart,
                          end: cell.periodEnd,
                          markDate: cell.toggleDate,
                        })
                      }
                      className="min-h-[52px] flex-1 content-start"
                    />

                    <div className="flex items-center gap-5 border-t border-border2 pt-2.5">
                      <div className="text-center">
                        <div className="text-lg font-extrabold text-habits">
                          {habitStreak(
                            frequency,
                            set,
                            weekStart,
                            td,
                            h.frequency,
                          )}
                        </div>
                        <div className="font-mono text-[9px] text-faint">
                          STREAK
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-extrabold">
                          {habitBestStreak(frequency, set, weekStart)}
                        </div>
                        <div className="font-mono text-[9px] text-faint">
                          BEST
                        </div>
                      </div>
                      <span className="ml-auto font-mono text-[9px] uppercase tracking-wide text-faint">
                        {habitFrequencyLabel(frequency)}
                      </span>
                    </div>
                  </SortableHabitCard>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </>
  );
}

/** Habit title that edits in place: click to focus, Enter/blur to save. */
function HabitName({
  name,
  onRename,
}: {
  name: string;
  onRename: (next: string) => void;
}) {
  const [draft, setDraft] = useState(name);

  // Reconcile with server state when the habit is renamed elsewhere.
  useEffect(() => setDraft(name), [name]);

  const save = () => {
    const next = draft.trim();
    if (!next || next === name) {
      setDraft(name);
      return;
    }
    onRename(next);
  };

  return (
    <EditableTitle
      value={draft}
      onChange={setDraft}
      onCommit={save}
      onCancel={() => setDraft(name)}
      maxLength={200}
      ariaLabel="Habit name"
      wrapperClassName="min-w-0 flex-1"
      className="py-0.5 text-[14.5px] font-semibold text-ink"
      iconClassName="h-3 w-3"
    />
  );
}

/**
 * A habit card you can pick up.
 *
 * The card's inert surface is the handle rather than a grip in a corner —
 * there is plenty of it, and `cursor-grab` says so. What the surface must not
 * swallow is the card's own controls: unlike a goal card, a habit card is a
 * live editor, and a drag started inside the rename field would take the card
 * with it instead of selecting text. So the drag listeners ignore any event
 * that begins on something interactive.
 *
 * Touch uses a hold delay rather than `touch-action: none`, so a finger
 * dragged across a card still scrolls the page — these cards are tall enough
 * that there would be nowhere else to put the finger.
 */
const INTERACTIVE =
  "input, textarea, select, button, a, label, [contenteditable='true']";
function SortableHabitCard({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const dragListeners = Object.fromEntries(
    Object.entries(listeners ?? {}).map(([name, handler]) => [
      name,
      (event: React.SyntheticEvent) => {
        const target = event.target as HTMLElement | null;
        const control = target?.closest?.(INTERACTIVE);
        if (control && control !== event.currentTarget) return;
        (handler as (e: React.SyntheticEvent) => void)(event);
      },
    ]),
  );

  // `role="group"` overrides dnd-kit's default `role="button"`: the card holds
  // a text field, a select and a row of toggles, and a button cannot contain
  // those.
  return (
    <div
      ref={setNodeRef}
      id={`habit-${id}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: "manipulation",
      }}
      className={cn(
        className,
        "cursor-grab active:cursor-grabbing",
        isDragging && "z-10 opacity-80 shadow-lg",
      )}
      {...attributes}
      role="group"
      {...dragListeners}
    >
      {children}
    </div>
  );
}
