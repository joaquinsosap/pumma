"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { Check } from "@/components/icons";
import type { Habit, HabitEntry } from "@/lib/schemas";
import { iso, weekDates, dowLetters, type WeekStart } from "@/lib/date";
import { useTimezone } from "@/components/shell/TimeZoneProvider";
import { toggleHabitPeriod } from "@/lib/actions/habits";
import {
  currentHabitPeriod,
  habitStreak,
  normalizeHabitFrequency,
} from "@/lib/habit-visibility";
import { cn } from "@/lib/utils";
import type { Goal } from "@/lib/schemas";
import {
  WidgetHeader,
  WidgetHeaderLink,
  WidgetRowLink,
} from "@/components/home/WidgetLink";
import { hrefWithLife, type LifeView } from "@/lib/life-area";
import {
  habitWeekRowClass,
  habitWeekCellClass,
  HabitWeekStrip,
} from "@/components/habits/habit-week-layout";

type Props = {
  habits: Habit[];
  habitEntries: HabitEntry[];
  goals: Goal[];
  topStreak: number;
  lifeView: LifeView;
  weekStart?: WeekStart;
};

export function HomeHabitsGoals({
  habits,
  habitEntries,
  goals,
  topStreak,
  lifeView,
  weekStart = "mon",
}: Props) {
  const timeZone = useTimezone();
  const td = iso(new Date(), timeZone);
  const week = weekDates(new Date(), weekStart, timeZone);
  const letters = dowLetters(weekStart);
  const [, startTransition] = useTransition();
  const [optimisticEntries, setOptimisticEntries] = useOptimistic(habitEntries);

  const entriesFor = (habitId: string) =>
    new Set(
      optimisticEntries.filter((e) => e.habitId === habitId).map((e) => e.date),
    );

  const habitsDone = habits.filter((h) =>
    optimisticEntries.some((e) => e.habitId === h.id && e.date === td),
  ).length;

  // Toggles the habit's own period: for a weekly habit "undone" has to clear
  // the whole week, or leftover entries keep it green.
  const toggle = (habitId: string, start: string, end: string) => {
    startTransition(async () => {
      const inRange = (e: { habitId: string; date: string }) =>
        e.habitId === habitId && e.date >= start && e.date <= end;
      setOptimisticEntries(
        optimisticEntries.some(inRange)
          ? optimisticEntries.filter((e) => !inRange(e))
          : [
              ...optimisticEntries,
              {
                id: "tmp",
                userId: "optimistic",
                habitId,
                date: td,
                done: true,
              },
            ],
      );
      // The action revalidates the route; the optimistic entry above holds
      // until that lands — no extra refresh round-trip.
      await toggleHabitPeriod({ habitId, start, end, markDate: td });
    });
  };

  return (
    <div className="flex flex-col gap-4 max-xl:shrink-0 xl:min-h-0">
      <section className="flex min-h-0 flex-col rounded-[13px] border border-border bg-surface px-[18px] py-[15px] max-xl:flex-none xl:flex-1 xl:overflow-hidden">
        <WidgetHeader accent="habits">
          <WidgetHeaderLink href={hrefWithLife("/habits", lifeView)}>
            <span className="h-2.5 w-2.5 rounded-full bg-habits" />
            <h3 className="m-0 text-sm font-bold">Habits</h3>
            <span className="font-mono text-[11px] text-faint">
              {habitsDone} / {habits.length} today
            </span>
          </WidgetHeaderLink>
        </WidgetHeader>
        <div
          className={cn("mb-2 border-b border-border2 pb-2", habitWeekRowClass)}
        >
          <span />
          <span />
          <HabitWeekStrip>
            {week.map((d, i) => {
              const isToday = iso(d) === td;
              return (
                <span
                  key={iso(d)}
                  className={cn(
                    habitWeekCellClass,
                    "text-center font-mono text-[9px] leading-3",
                    isToday ? "font-bold text-ink" : "text-faint2",
                  )}
                >
                  {letters[i]}
                </span>
              );
            })}
          </HabitWeekStrip>
          <span />
        </div>
        <div className="flex flex-col gap-2 max-xl:overflow-visible xl:overflow-y-auto">
          {habits.map((h) => {
            const set = entriesFor(h.id);
            const freq = normalizeHabitFrequency(h.frequency.type);
            const period = currentHabitPeriod(freq, weekStart, td, timeZone);
            const doneToday = [...set].some(
              (d) => d >= period.start && d <= period.end,
            );
            const streak = habitStreak(freq, set, weekStart, td);
            return (
              <div key={h.id} className={habitWeekRowClass}>
                <button
                  type="button"
                  onClick={() => toggle(h.id, period.start, period.end)}
                  className={cn(
                    "flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-md border-[1.8px]",
                    doneToday
                      ? "border-none bg-habits"
                      : "border-border bg-transparent",
                  )}
                >
                  {doneToday && (
                    <Check
                      className="h-[11px] w-[11px] text-white"
                      strokeWidth={3.2}
                    />
                  )}
                </button>
                <Link
                  href={hrefWithLife(`/habits?habit=${h.id}`, lifeView)}
                  className={cn(
                    "min-w-0 truncate text-[13px] transition-colors hover:underline",
                    doneToday ? "text-ink" : "text-muted",
                  )}
                >
                  {h.name}
                </Link>
                {freq === "daily" ? (
                  <HabitWeekStrip>
                    {week.map((d) => {
                      const ds = iso(d);
                      const on = set.has(ds);
                      const isToday = ds === td;
                      return (
                        <span
                          key={ds}
                          className={habitWeekCellClass}
                          style={{
                            background: on
                              ? "oklch(0.6 0.13 155)"
                              : "transparent",
                            border: on ? "none" : "1.5px solid var(--border)",
                            borderRadius: "3px",
                            outline: isToday
                              ? on
                                ? "2px solid oklch(0.6 0.13 155)"
                                : "2px solid var(--border)"
                              : "none",
                            outlineOffset: "1.5px",
                          }}
                        />
                      );
                    })}
                  </HabitWeekStrip>
                ) : (
                  <CadencePill frequency={freq} done={doneToday} today={td} />
                )}
                <span
                  className={cn(
                    "text-right font-mono text-[10px] font-semibold",
                    streak > 0 ? "text-habits" : "text-faint2",
                  )}
                >
                  {streak}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-[13px] border border-border bg-surface px-[18px] py-[15px]">
        <WidgetHeader accent="goals">
          <WidgetHeaderLink href={hrefWithLife("/goals", lifeView)}>
            <span className="h-2.5 w-2.5 rotate-45 bg-goals" />
            <h3 className="m-0 text-sm font-bold">Goals</h3>
            <span className="font-mono text-[11px] text-faint">Q3</span>
            <span className="ml-auto text-xs font-medium text-primary">
              View all →
            </span>
          </WidgetHeaderLink>
        </WidgetHeader>
        <div className="flex flex-col gap-3">
          {goals.slice(0, 3).map((g) => {
            const personal = g.category === "personal";
            return (
              <WidgetRowLink
                key={g.id}
                href={hrefWithLife(
                  `/goals?category=${g.category}&goal=${g.id}`,
                  lifeView,
                )}
                className="-mx-1 px-1 py-0.5"
              >
                <div className="mb-1.5 flex justify-between text-[13px]">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="rounded px-1 py-px font-mono text-[9px]"
                      /* Off the tokens rather than fixed oklch values: these
                         were picked against a light panel and left dark text
                         on a dark ground once the theme flipped. */
                      style={{
                        color: personal ? "var(--goals)" : "var(--projects)",
                        background: personal
                          ? "color-mix(in oklab, var(--goals) 16%, transparent)"
                          : "color-mix(in oklab, var(--projects) 16%, transparent)",
                      }}
                    >
                      {personal ? "PERSONAL" : "WORK"}
                    </span>
                    {g.title}
                  </span>
                  <span className="font-mono font-semibold text-muted">
                    {g.progress}%
                  </span>
                </div>
                <div className="h-[7px] overflow-hidden rounded-full bg-border2">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${g.progress}%`,
                      background: personal
                        ? "oklch(0.58 0.17 300)"
                        : "oklch(0.58 0.14 245)",
                    }}
                  />
                </div>
              </WidgetRowLink>
            );
          })}
        </div>
      </section>

      <Link
        href={hrefWithLife("/habits", lifeView)}
        className="flex items-center gap-3.5 rounded-[13px] border border-border bg-[#1b1a18] p-[16px_18px] text-white transition-opacity hover:opacity-95"
      >
        <div className="text-[34px] leading-none">🔥</div>
        <div className="flex-1">
          <div className="text-[21px] font-extrabold leading-tight tracking-tight">
            {topStreak} days strong.
          </div>
          <div className="mt-0.5 text-[12.5px] text-white/60">
            {topStreak > 0
              ? "Skip today and you're back to zero. Don't."
              : "Start one today — momentum compounds."}
          </div>
        </div>
      </Link>
    </div>
  );
}

/**
 * Weekly/monthly habits don't have a per-weekday answer, so the 7-box strip
 * (which silently implied "did you do it Tuesday?") is replaced by a pill that
 * names its own period. Same width as the strip, so rows stay aligned.
 */
function CadencePill({
  frequency,
  done,
  today,
}: {
  frequency: "weekly" | "monthly";
  done: boolean;
  today: string;
}) {
  const label =
    frequency === "weekly"
      ? "this week"
      : new Date(today + "T00:00").toLocaleDateString("en-US", {
          month: "long",
        });

  return (
    <span
      title={
        done
          ? `Done ${frequency === "weekly" ? "this week" : "this month"}`
          : `Not done yet ${frequency === "weekly" ? "this week" : "this month"}`
      }
      className={cn(
        "flex h-[15px] min-w-[102px] items-center justify-center gap-1 rounded-full border px-2 font-mono text-[8.5px] uppercase tracking-wider",
        done
          ? "border-transparent bg-habits/15 font-bold text-habits"
          : "border-border text-faint2",
      )}
    >
      {done && <Check className="h-2 w-2" strokeWidth={4} />}
      {label}
    </span>
  );
}
