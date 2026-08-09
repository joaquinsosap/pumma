"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, X } from "@/components/icons";
import { toast } from "sonner";
import type { Goal, Habit, HabitEntry, Project, Tag, Task } from "@/lib/schemas";
import {
  updateGoalDetailAction,
  setGoalProgress,
  deleteGoalAction,
} from "@/lib/actions/goals";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ScrollHint } from "@/components/ui/scroll-hint";
import { attachHabitToGoal, detachHabitFromGoal, linkProjectToGoal, updateHabitGoalTargetAction } from "@/lib/actions/links";
import {
  DEFAULT_HABIT_GOAL_STREAK,
  goalHasLinks,
  goalProgressBreakdown,
} from "@/lib/goal-sync";
import { GoalMultiLinkField } from "@/components/links/GoalLinkField";
import { HabitHeatStrip } from "@/components/habits/HabitHeatStrip";
import { DueQuickPick } from "@/components/shell/DueQuickPick";
import {
  habitFrequencyLabel,
  normalizeHabitFrequency,
  type HabitVisibilitySettings,
} from "@/lib/habit-visibility";
import type { WeekStart } from "@/lib/date";
import { useSyncedDraft } from "@/lib/use-synced-draft";
import { EntityTagRow } from "@/components/tags/EntityTagRow";

type Props = {
  goal: Goal;
  tags: Tag[];
  projects: Project[];
  habits: Habit[];
  habitEntries: HabitEntry[];
  tasks: Task[];
  habitVisibility: HabitVisibilitySettings;
  weekStart: WeekStart;
  onClose: () => void;
};

export function GoalDetailPanel({
  goal,
  tags,
  projects,
  habits,
  habitEntries,
  tasks,
  habitVisibility,
  weekStart,
  onClose,
}: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();
  const [title, setTitle] = useSyncedDraft(goal.title, goal.id);
  const [metricLabel, setMetricLabel] = useSyncedDraft(goal.metricLabel, goal.id);
  const [targetDate, setTargetDate] = useSyncedDraft(goal.targetDate ?? "", goal.id);

  const autoProgress = goalHasLinks(goal.id, projects, habits);
  const breakdown = goalProgressBreakdown(
    goal.id,
    projects,
    habits,
    habitEntries,
    tasks
  );

  const linkedHabits = breakdown.habitParts;
  const linkedProjects = breakdown.projectParts;
  const availableProjects = projects.filter(
    (p) => !p.goalId || p.goalId === goal.id
  ).filter((p) => p.goalId !== goal.id);
  const availableHabits = habits
    .filter((h) => !h.archived && !h.goalIds.includes(goal.id));

  const persist = useCallback(
    (patch: {
      title?: string;
      metricLabel?: string;
      targetDate?: string | null;
    }) => {
      startTransition(async () => {
        await updateGoalDetailAction({ id: goal.id, ...patch });
        router.refresh();
      });
    },
    [goal.id, router]
  );

  // Manual progress: the bar used to render the server value and fire one
  // round-trip per tap, so nothing moved until it landed — you tap again, and
  // the deltas pile up. Show the change instantly and send a single request
  // once the tapping settles.
  const [shownProgress, setShownProgress] = useState<number | null>(null);
  const pendingDeltaRef = useRef(0);
  const bumpTimerRef = useRef<number | null>(null);

  const flushProgress = useCallback(() => {
    if (bumpTimerRef.current) {
      window.clearTimeout(bumpTimerRef.current);
      bumpTimerRef.current = null;
    }
    const total = pendingDeltaRef.current;
    pendingDeltaRef.current = 0;
    if (!total) return;
    // Not wrapped in startTransition: this also runs while the panel unmounts.
    void setGoalProgress(goal.id, total);
  }, [goal.id]);

  // The live value also lives in a ref: rapid taps are batched, so reading it
  // from render state made every tap in a burst compute from the same stale
  // number and the bar moved once instead of once per tap.
  const displayedRef = useRef(goal.progress);

  // Adopt the server value again once it catches up (or the goal changes).
  useEffect(() => {
    setShownProgress(null);
    displayedRef.current = goal.progress;
    pendingDeltaRef.current = 0;
  }, [goal.id, goal.progress]);

  // Never drop taps that haven't been sent yet.
  useEffect(() => {
    return () => {
      flushProgress();
    };
  }, [goal.id, flushProgress]);

  const displayedProgress = shownProgress ?? goal.progress;

  const bumpProgress = (delta: number) => {
    const base = displayedRef.current;
    const next = Math.max(0, Math.min(100, base + delta));
    displayedRef.current = next;
    // Accumulate the EFFECTIVE change, so clamping at 0/100 can't drift the
    // pending total away from what's on screen.
    pendingDeltaRef.current += next - base;
    setShownProgress(next);
    if (bumpTimerRef.current) window.clearTimeout(bumpTimerRef.current);
    bumpTimerRef.current = window.setTimeout(flushProgress, 350);
  };

  const saveTitle = () => {
    const next = title.trim();
    if (next === goal.title) return;
    if (!next) return;
    persist({ title: next });
  };

  const handleDelete = async () => {
    const linkedCount = linkedProjects.length + linkedHabits.length;
    const ok = await confirm({
      title: `Delete "${goal.title}"?`,
      description:
        linkedCount > 0
          ? `${linkedCount} linked item${linkedCount === 1 ? "" : "s"} (projects/habits) will be kept but unlinked from this goal.`
          : undefined,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;

    startTransition(async () => {
      const res = await deleteGoalAction(goal.id);
      if (!res.ok) {
        toast.error(res.error ?? "Could not delete goal");
        return;
      }
      toast.success("Goal deleted");
      onClose();
      router.refresh();
    });
  };

  const categoryColor =
    goal.category === "personal"
      ? "oklch(0.58 0.17 300)"
      : "oklch(0.58 0.14 245)";

  return (
    <aside className="relative flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-border2 px-4 py-3">
        <div className="min-w-0">
          <p className="m-0 font-mono text-[10px] uppercase tracking-widest text-faint">
            {goal.category}
          </p>
          <p className="m-0 truncate text-sm font-bold text-ink">Goal details</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-faint hover:bg-hover hover:text-ink"
          aria-label="Close goal details"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <section className="mb-5">
          <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            Title
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="w-full rounded-lg border border-border bg-background/50 px-3 py-2 text-[15px] font-bold text-ink outline-none focus:border-faint"
            maxLength={120}
          />
        </section>

        <section className="mb-5">
          <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            Tags
          </h4>
          <EntityTagRow
            entity="goal"
            entityId={goal.id}
            tags={tags}
            selectedTagIds={goal.tagIds}
          />
          <p className="m-0 mt-1.5 text-[11px] leading-relaxed text-faint">
            Personal or work decides the column this goal sits in.
          </p>
        </section>

        <section className="mb-5 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
              Metric
            </span>
            <input
              value={metricLabel}
              onChange={(e) => setMetricLabel(e.target.value)}
              onBlur={() => {
                if (metricLabel !== goal.metricLabel) persist({ metricLabel });
              }}
              placeholder="e.g. B1, $10k"
              className="w-full rounded-lg border border-border bg-background/50 px-3 py-2 text-sm outline-none focus:border-faint"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
              Target date
            </span>
            <DueQuickPick
              mode="goal"
              value={targetDate || null}
              onChange={(next) => {
                setTargetDate(next ?? "");
                const normalized = next || null;
                if (normalized !== goal.targetDate) {
                  persist({ targetDate: normalized });
                }
              }}
            />
          </label>
        </section>

        <section className="mb-5 rounded-xl border border-border bg-surface2/50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold">Progress</span>
            <span
              className="font-mono text-sm font-semibold"
              style={{ color: categoryColor }}
            >
              {displayedProgress}%
            </span>
          </div>
          <div className="mb-2 h-2 overflow-hidden rounded-full bg-border2">
            <div
              className="h-full rounded-full"
              style={{
                width: `${displayedProgress}%`,
                background: categoryColor,
                transition: "width 150ms ease-out",
              }}
            />
          </div>
          {autoProgress ? (
            <p className="m-0 font-mono text-[10px] text-faint">
              Auto-calculated from linked habits and projects below.
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border text-muted hover:bg-hover"
                onClick={() => bumpProgress(-5)}
              >
                −
              </button>
              <button
                type="button"
                className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border text-muted hover:bg-hover"
                onClick={() => bumpProgress(5)}
              >
                +
              </button>
              <span className="font-mono text-[10px] text-faint">Manual progress</span>
            </div>
          )}
        </section>

        <section className="mb-5">
          <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            Habits
          </h4>
          <p className="mb-3 text-[12px] leading-relaxed text-faint">
            Each habit contributes based on current streak vs your target streak.
          </p>
          <div className="mb-3 flex flex-col gap-2">
            {linkedHabits.length ? (
              linkedHabits.map(({ habit, streak, target, progress }) => (
                <HabitGoalLinkRow
                  key={habit.id}
                  habit={habit}
                  streak={streak}
                  target={target}
                  progress={progress}
                  habitEntries={habitEntries}
                  habitVisibility={habitVisibility}
                  weekStart={weekStart}
                  onTargetChange={(value) =>
                    startTransition(async () => {
                      await updateHabitGoalTargetAction(habit.id, value);
                      router.refresh();
                    })
                  }
                  onRemove={() =>
                    startTransition(async () => {
                      await detachHabitFromGoal(habit.id, goal.id);
                      router.refresh();
                    })
                  }
                />
              ))
            ) : (
              <p className="m-0 rounded-lg border border-dashed border-border px-3 py-2 text-[12px] text-faint">
                No habits linked yet.
              </p>
            )}
          </div>
          <GoalMultiLinkField
            label="Add habit"
            items={[]}
            available={availableHabits.map((h) => ({ id: h.id, title: h.name }))}
            dotShape="circle"
            onAttach={(habitId) =>
              startTransition(async () => {
                const res = await attachHabitToGoal(habitId, goal.id, DEFAULT_HABIT_GOAL_STREAK);
                if (!res.ok) toast.error(res.error ?? "Could not link habit");
                router.refresh();
              })
            }
            onDetach={() => {}}
          />
        </section>

        <section>
          <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            Projects
          </h4>
          <p className="mb-3 text-[12px] leading-relaxed text-faint">
            Each project adds its task completion % to the goal average.
          </p>
          <div className="mb-3 flex flex-col gap-2">
            {linkedProjects.length ? (
              linkedProjects.map(({ project, progress, label }) => (
                <div
                  key={project.id}
                  className="rounded-lg border border-border bg-background/40 px-3 py-2.5"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                      style={{ background: project.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {project.title}
                    </span>
                    <span className="font-mono text-[11px] font-semibold text-muted">
                      {progress}%
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        startTransition(async () => {
                          await linkProjectToGoal(project.id, null);
                          router.refresh();
                        })
                      }
                      className="flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink"
                      aria-label={`Unlink ${project.title}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-border2">
                    <div
                      className="h-full"
                      style={{ width: `${progress}%`, background: project.color }}
                    />
                  </div>
                  <p className="mt-1.5 font-mono text-[10px] text-faint">{label} tasks done</p>
                </div>
              ))
            ) : (
              <p className="m-0 rounded-lg border border-dashed border-border px-3 py-2 text-[12px] text-faint">
                No projects linked yet.
              </p>
            )}
          </div>
          <GoalMultiLinkField
            label="Add project"
            items={[]}
            available={availableProjects.map((p) => ({ id: p.id, title: p.title }))}
            onAttach={(projectId) =>
              startTransition(async () => {
                const res = await linkProjectToGoal(projectId, goal.id);
                if (!res.ok) toast.error(res.error ?? "Could not link project");
                router.refresh();
              })
            }
            onDetach={() => {}}
          />
        </section>

        <section className="border-t border-border2 pt-4">
          <button
            type="button"
            onClick={handleDelete}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-tasks/30 bg-tasks/[0.06] px-3 py-2 text-[13px] font-semibold text-tasks transition-colors hover:border-tasks/50 hover:bg-tasks/10"
          >
            <Trash2 className="h-4 w-4" />
            Delete goal
          </button>
        </section>
      </div>
      <ScrollHint targetRef={bodyRef} direction="down" />
    </aside>
  );
}

function HabitGoalLinkRow({
  habit,
  streak,
  target,
  progress,
  habitEntries,
  habitVisibility,
  weekStart,
  onTargetChange,
  onRemove,
}: {
  habit: Habit;
  streak: number;
  target: number;
  progress: number;
  habitEntries: HabitEntry[];
  habitVisibility: HabitVisibilitySettings;
  weekStart: WeekStart;
  onTargetChange: (value: number) => void;
  onRemove: () => void;
}) {
  const [targetInput, setTargetInput] = useState(String(target));
  const frequency = normalizeHabitFrequency(habit.frequency.type);
  const entries = new Set(
    habitEntries.filter((e) => e.habitId === habit.id).map((e) => e.date)
  );

  useEffect(() => {
    setTargetInput(String(target));
  }, [target]);

  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-habits" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{habit.name}</span>
        <span className="shrink-0 rounded px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-wide text-habits/90 bg-habits/10">
          {habitFrequencyLabel(frequency)}
        </span>
        <span className="font-mono text-[11px] font-semibold text-habits">{progress}%</span>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-ink"
          aria-label={`Unlink ${habit.name}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <HabitHeatStrip
        habit={habit}
        entries={entries}
        visibility={habitVisibility}
        weekStart={weekStart}
        compact
        className="mb-2"
      />
      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-border2">
        <div
          className="h-full rounded-full bg-habits"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <span className="font-mono text-[11px] text-faint">
          Streak {streak} /{" "}
        </span>
        <input
          type="number"
          min={1}
          max={999}
          value={targetInput}
          onChange={(e) => setTargetInput(e.target.value)}
          onBlur={() => {
            const trimmed = targetInput.trim();
            if (!trimmed) {
              setTargetInput(String(target));
              return;
            }
            const parsed = Number(trimmed);
            if (!Number.isFinite(parsed)) {
              setTargetInput(String(target));
              return;
            }
            const next = Math.max(1, Math.min(999, Math.round(parsed)));
            setTargetInput(String(next));
            if (next !== target) onTargetChange(next);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="w-16 rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[11px] outline-none focus:border-faint"
        />
        <span className="font-mono text-[11px] text-faint">day target</span>
      </div>
    </div>
  );
}
