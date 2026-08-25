"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LifeDay, LifeWeek, Task } from "@/lib/schemas";
import { iso } from "@/lib/date";
import { useTimezone } from "@/components/shell/TimeZoneProvider";
import {
  buildLifeWeekGrid,
  buildLifeWeekMap,
  computeLifeStats,
  LIFE_GRID_COLS,
  LIFE_MOODS,
  clampLifeSpanYears,
  lifeViewStartAge,
  type LifeWeekSlot,
} from "@/lib/life-calendar";
import { LifeWeekCell, LifeWeekEmpty } from "@/components/life/LifeWeekCell";
import { LifeWeekDialog } from "@/components/life/LifeWeekDialog";
import { Topbar } from "@/components/shell/Topbar";
import { Switch } from "@/components/ui/switch";
import { updateSettingsAction } from "@/lib/actions/settings";
import { cn } from "@/lib/utils";

type Props = {
  birthDate: string | null;
  lifeSpanYears: number;
  lifeCalendarFullView: boolean;
  lifeDays: LifeDay[];
  lifeWeeks: LifeWeek[];
  tasks: Task[];
  stats: { dayPct: number; habitsLabel: string; topStreak: number };
};

export function LifeCalendarView({
  birthDate,
  lifeSpanYears,
  lifeCalendarFullView,
  lifeDays,
  lifeWeeks,
  tasks,
  stats,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const timeZone = useTimezone();
  const today = iso(new Date(), timeZone);
  const [selectedWeek, setSelectedWeek] = useState<LifeWeekSlot | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fullView, setFullView] = useState(lifeCalendarFullView);
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);

  useEffect(() => {
    setFullView(lifeCalendarFullView);
  }, [lifeCalendarFullView]);

  const setFullViewPersisted = (next: boolean) => {
    setFullView(next);
    startTransition(async () => {
      await updateSettingsAction({ lifeCalendarFullView: next });
      router.refresh();
    });
  };

  const span = clampLifeSpanYears(lifeSpanYears);

  const lifeDayMap = useMemo(
    () => new Map(lifeDays.map((d) => [d.date, d])),
    [lifeDays],
  );

  const lifeStats = useMemo(
    () => (birthDate ? computeLifeStats(birthDate, span, today) : null),
    [birthDate, span, today],
  );

  const grid = useMemo(
    () =>
      birthDate && lifeStats
        ? buildLifeWeekGrid(birthDate, span, lifeStats.ageYears)
        : { weeks: [], rows: [], viewStartAge: 0 },
    [birthDate, span, lifeStats],
  );

  const lifeWeekMap = useMemo(
    () => buildLifeWeekMap(lifeWeeks, grid.weeks),
    [lifeWeeks, grid.weeks],
  );

  useEffect(() => {
    didInitialScrollRef.current = false;
  }, [birthDate, span]);

  useEffect(() => {
    if (
      fullView ||
      didInitialScrollRef.current ||
      !gridScrollRef.current ||
      !lifeStats
    )
      return;
    const scrollAge = lifeViewStartAge(lifeStats.ageYears);
    const target = gridScrollRef.current.querySelector(
      `[data-life-age="${scrollAge}"]`,
    );
    if (!target) return;
    target.scrollIntoView({ block: "start" });
    didInitialScrollRef.current = true;
  }, [grid.rows.length, lifeStats, fullView]);

  const memoryCount = useMemo(() => {
    let n = 0;
    for (const w of lifeWeeks) {
      if (w.mood || w.note?.trim()) n += 1;
    }
    for (const d of lifeDays) {
      if (d.mood || d.note?.trim()) n += 1;
    }
    return n;
  }, [lifeWeeks, lifeDays]);

  const weekHasNote = (week: LifeWeekSlot) => {
    const entry = lifeWeekMap.get(week.weekStart);
    if (entry?.note?.trim()) return true;
    return week.days.some((d) => {
      const day = lifeDayMap.get(d);
      return Boolean(day?.note?.trim() || day?.mood);
    });
  };

  const openWeek = (weekStart: string) => {
    const week = grid.weeks.find((w) => w.weekStart === weekStart) ?? null;
    setSelectedWeek(week);
    setDialogOpen(true);
  };

  return (
    <>
      <Topbar
        title="Life calendar"
        dayPct={stats.dayPct}
        habitsLabel={stats.habitsLabel}
        topStreak={stats.topStreak}
        birthDate={birthDate}
        lifeSpanYears={lifeSpanYears}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pb-0 animate-pumma-view">
        {!birthDate ? (
          <div
            className="rounded-[14px] border-2 border-dashed border-border bg-surface2/50 px-6 py-12 text-center"
            style={{ boxShadow: "2px 2px 0 var(--shadow)" }}
          >
            <p className="m-0 text-sm font-semibold text-ink">
              Set your birth date to begin
            </p>
            <p className="mx-auto mt-2 max-w-sm text-[13px] text-faint">
              Your life calendar maps up to {span} years, one square per week.
            </p>
            <Link
              href="/settings"
              className="mt-4 inline-block rounded-lg bg-ink px-4 py-2 text-sm font-bold text-background"
            >
              Open settings
            </Link>
          </div>
        ) : (
          lifeStats && (
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden max-lg:overflow-y-auto max-lg:pb-28">
              <div
                className="shrink-0 rounded-[14px] border border-border bg-surface px-5 py-3 max-lg:order-3 max-lg:px-4"
                style={{ boxShadow: "2px 2px 0 var(--shadow)" }}
              >
                <div className="mb-2.5 flex flex-wrap gap-x-10 gap-y-2 max-lg:mb-2 max-lg:grid max-lg:grid-cols-2 max-lg:gap-x-6 max-lg:gap-y-3 sm:gap-x-14">
                  <StatLine
                    label="Days"
                    lived={lifeStats.livedDays}
                    left={lifeStats.leftDays}
                  />
                  <StatLine
                    label="Weeks"
                    lived={lifeStats.livedWeeks}
                    left={lifeStats.leftWeeks}
                  />
                  <StatLine
                    label="Age"
                    lived={lifeStats.ageYears}
                    left={lifeStats.ageLeftYears}
                    suffix="y"
                  />
                  <StatLine
                    label="Of life"
                    lived={lifeStats.livedPct}
                    left={100 - lifeStats.livedPct}
                    suffix="%"
                    livedClassName="text-primary"
                  />
                  <StatLine
                    label="Memories"
                    lived={memoryCount}
                    hideLeft
                    livedClassName="text-tasks"
                  />
                </div>
                <div className="mb-2 h-[9px] overflow-hidden rounded-full bg-border2">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${lifeStats.livedPct}%` }}
                  />
                </div>
                <div className="flex flex-wrap justify-between gap-2 font-mono text-[11px] text-faint">
                  <span>
                    {lifeStats.livedPct}% of life behind you ·{" "}
                    {100 - lifeStats.livedPct}% ahead
                  </span>
                  <span>
                    {lifeStats.birthDate} → {lifeStats.endDate}
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-faint max-lg:order-2">
                {fullView ? (
                  <>
                    <LegendSwatch className="bg-lived" label="lived" />
                    <LegendSwatch className="bg-ahead" label="ahead" />
                    <LegendSwatch
                      className="bg-[var(--life-now)]"
                      label="this week"
                    />
                    <span className="h-3 w-px bg-border" />
                    {LIFE_MOODS.map((m) => (
                      <LegendSwatch
                        key={m.value}
                        className="border-0"
                        style={{ background: m.color }}
                        label={m.label}
                      />
                    ))}
                    <span className="text-faint2">
                      full life · {span} years · click a week for details
                    </span>
                  </>
                ) : (
                  <>
                    <LegendSwatch className="bg-lived" label="lived" />
                    <LegendSwatch
                      className="border border-border2 bg-transparent"
                      label="ahead"
                    />
                    <LegendSwatch
                      className="bg-[var(--life-now)]"
                      label="this week"
                    />
                    <span className="h-3 w-px bg-border" />
                    {LIFE_MOODS.map((m) => (
                      <LegendSwatch
                        key={m.value}
                        className="border-0"
                        style={{ background: m.color }}
                        label={m.label}
                      />
                    ))}
                    <span className="text-faint2">
                      each box = one week · click to add a memory + mood
                    </span>
                  </>
                )}
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-faint">
                  <span className="select-none">Full view</span>
                  <Switch
                    checked={fullView}
                    onCheckedChange={setFullViewPersisted}
                  />
                </label>
              </div>

              <div
                className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-border bg-surface px-4 py-3 max-lg:order-1 max-lg:h-[56dvh] max-lg:flex-none max-lg:px-2 sm:px-5"
                style={{ boxShadow: "2px 2px 0 var(--shadow)" }}
              >
                <div className="mb-2.5 flex shrink-0 items-center justify-between font-mono text-[10px] tracking-wide text-faint2">
                  <span className={cn(fullView ? "pl-[22px]" : "pl-[30px]")}>
                    AGE 0
                  </span>
                  <span className={fullView ? "text-[9px]" : undefined}>
                    ← {LIFE_GRID_COLS} WEEKS PER ROW →
                  </span>
                  <span
                    className={cn(
                      "max-sm:pr-0",
                      fullView ? "pr-[32px]" : "pr-[42px]",
                    )}
                  >
                    AGE {span}
                  </span>
                </div>
                <div
                  ref={gridScrollRef}
                  className={cn(
                    "min-h-0 flex-1",
                    fullView
                      ? "flex flex-col overflow-hidden"
                      : "overflow-y-auto overflow-x-hidden",
                  )}
                >
                  <div
                    className={cn(
                      "flex flex-col",
                      fullView
                        ? "h-full flex-1 gap-px"
                        : "gap-[3px] max-sm:gap-[1px]",
                    )}
                  >
                    {grid.rows.map((row) => (
                      <div
                        key={row.age}
                        data-life-age={row.age}
                        className={cn(
                          "flex min-h-0 items-center",
                          fullView
                            ? "flex-1 gap-px"
                            : "gap-[3px] max-sm:gap-[1px]",
                          !fullView && row.decadeGap && "mt-1.5",
                        )}
                      >
                        <span
                          className={cn(
                            "shrink-0 pr-0.5 text-right font-mono tabular-nums",
                            fullView
                              ? "w-[22px] text-[7px]"
                              : "w-[30px] text-[9px] max-sm:w-[22px] max-sm:text-[8px]",
                            row.age === lifeStats.ageYears
                              ? "font-bold text-primary"
                              : row.ageEmphasis
                                ? "font-bold text-faint"
                                : "text-faint",
                            fullView && !row.ageEmphasis && "text-faint2",
                          )}
                        >
                          {fullView
                            ? row.age % 10 === 0 ||
                              row.age === lifeStats.ageYears
                              ? row.age
                              : ""
                            : row.showAgeLabel
                              ? row.age
                              : ""}
                        </span>
                        <div
                          className={cn(
                            "flex min-h-0 min-w-0 flex-1",
                            fullView
                              ? "h-full gap-px"
                              : "gap-[3px] max-sm:flex-wrap max-sm:gap-[1px]",
                          )}
                        >
                          {row.cells.map((week, col) => {
                            if (!week) {
                              return (
                                <LifeWeekEmpty
                                  key={`e-${row.age}-${col}`}
                                  fullView={fullView}
                                />
                              );
                            }
                            const entry = lifeWeekMap.get(week.weekStart);
                            return (
                              <LifeWeekCell
                                key={week.weekStart}
                                weekStart={week.weekStart}
                                weekEnd={week.weekEnd}
                                weekIndex={week.weekIndex}
                                today={today}
                                mood={entry?.mood}
                                hasNote={weekHasNote(week)}
                                fullView={fullView}
                                onSelect={openWeek}
                              />
                            );
                          })}
                        </div>
                        <span
                          className={cn(
                            "shrink-0 pl-1 font-mono tabular-nums text-faint2 max-sm:hidden",
                            fullView
                              ? "w-[32px] text-[7px]"
                              : "w-[42px] text-[9px]",
                            row.yearEmphasis && "font-bold text-faint",
                          )}
                        >
                          {fullView
                            ? row.age % 10 === 0 ||
                              row.age === lifeStats.ageYears
                              ? row.yearLabel
                              : ""
                            : row.yearLabel}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )
        )}
      </div>

      <LifeWeekDialog
        week={selectedWeek}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        birthDate={birthDate}
        lifeWeek={
          selectedWeek
            ? (lifeWeekMap.get(selectedWeek.weekStart) ?? null)
            : null
        }
        today={today}
      />
    </>
  );
}

function StatLine({
  label,
  lived,
  left,
  suffix = "",
  livedLabel = "lived",
  leftLabel = "left",
  livedClassName,
  leftClassName = "text-primary",
  hideLeft = false,
}: {
  label: string;
  lived: number;
  left?: number;
  suffix?: string;
  livedLabel?: string;
  leftLabel?: string;
  livedClassName?: string;
  leftClassName?: string;
  hideLeft?: boolean;
}) {
  const value = (n: number, className?: string) => (
    <span className={className}>
      {n.toLocaleString()}
      {suffix && (
        <span className="text-[13px] font-medium text-faint max-lg:text-[11px]">
          {suffix}
        </span>
      )}
    </span>
  );

  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] tracking-widest text-faint2">
        {label}
      </div>
      <div className="text-[21px] font-extrabold tracking-tight text-ink max-lg:text-[15px]">
        {hideLeft ? (
          value(lived, livedClassName)
        ) : (
          <>
            {value(lived, livedClassName)}
            <span className="ml-1.5 text-[13px] font-medium text-faint max-lg:ml-1 max-lg:text-[10px]">
              {livedLabel}
            </span>
            {value(left!, cn("ml-2", leftClassName))}
            <span className="ml-1.5 text-[13px] font-medium text-faint max-lg:ml-1 max-lg:text-[10px]">
              {leftLabel}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function LegendSwatch({
  label,
  className,
  style,
}: {
  label: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn("h-[11px] w-[11px] shrink-0", className)}
        style={style}
      />
      {label}
    </span>
  );
}
