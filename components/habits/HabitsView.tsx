"use client";
import { DeleteButton } from "@/components/ui/delete-button";
import { EntityTagRow } from "@/components/tags/EntityTagRow";

import { useEffect, useOptimistic, useState, useTransition } from "react";
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
} from "@/lib/actions/habits";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { attachHabitToGoal, detachHabitFromGoal } from "@/lib/actions/links";
import { Topbar } from "@/components/shell/Topbar";
import { GoalMultiLinkField } from "@/components/links/GoalLinkField";
import { HabitHeatStrip } from "@/components/habits/HabitHeatStrip";
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
  const [, startTransition] = useTransition();
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
      t: { habitId: string; start: string; end: string; markDate: string }
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
    }
  );

  const entriesFor = (id: string) =>
    new Set(
      optimisticEntries.filter((e) => e.habitId === id).map((e) => e.date)
    );

  const togglePeriod = (
    id: string,
    period: { start: string; end: string; markDate: string }
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
      <div className="min-h-0 flex-1 overflow-y-auto pb-6 max-lg:pb-28 animate-pumma-view">
        <div className="mb-4 flex items-center gap-3">
          <span className="font-mono text-[11px] text-faint">
            {stats.habitsLabel} done today · best streak {stats.topStreak}🔥
          </span>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {habits.map((h) => {
            const set = entriesFor(h.id);
            const frequency = normalizeHabitFrequency(h.frequency.type);
            // The checkbox reflects the habit's OWN period, not just today —
            // for a weekly habit, "done" means done somewhere this week.
            const period = currentHabitPeriod(frequency, weekStart, td, timeZone);
            const doneToday = [...set].some(
              (d) => d >= period.start && d <= period.end
            );
            const linkedGoals = goals.filter((g) => h.goalIds.includes(g.id));
            const availableGoals = goals.filter((g) => !h.goalIds.includes(g.id));
            return (
              <div
                key={h.id}
                id={`habit-${h.id}`}
                className={cn(
                  "flex min-h-[168px] flex-col gap-3 rounded-[13px] border border-border bg-surface p-4 hover:border-faint2",
                  h.archived && "opacity-45",
                  habitId === h.id && "ring-2 ring-habits/35"
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
                      doneToday ? "border-none bg-habits" : "border-border"
                    )}
                  >
                    {doneToday && (
                      <Check className="h-[13px] w-[13px] text-white" strokeWidth={3.2} />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <HabitName
                        name={h.name}
                        onRename={(next) =>
                          startTransition(async () => {
                            const res = await renameHabit(h.id, next);
                            if (!res.ok) toast.error(res.error ?? "Rename failed");
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
                        <option value="daily">{habitFrequencyLabel("daily")}</option>
                        <option value="weekly">{habitFrequencyLabel("weekly")}</option>
                        <option value="monthly">{habitFrequencyLabel("monthly")}</option>
                      </select>
                    </div>
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
                      aria-label={h.archived ? "Enable habit" : "Disable habit"}
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
                      {habitStreak(frequency, set, weekStart, td)}
                    </div>
                    <div className="font-mono text-[9px] text-faint">STREAK</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-extrabold">
                      {habitBestStreak(frequency, set, weekStart)}
                    </div>
                    <div className="font-mono text-[9px] text-faint">BEST</div>
                  </div>
                  <span className="ml-auto font-mono text-[9px] uppercase tracking-wide text-faint">
                    {habitFrequencyLabel(frequency)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
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
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(name);
          e.currentTarget.blur();
        }
      }}
      maxLength={200}
      aria-label="Habit name"
      className="min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1 py-0.5 -mx-1 text-[14.5px] font-semibold text-ink outline-none transition-colors hover:border-border focus:border-faint focus:bg-background/50"
    />
  );
}
