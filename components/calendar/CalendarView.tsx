"use client";
import { DeleteButton } from "@/components/ui/delete-button";
import { ALL_DAY_LABEL, isLinked, type AgendaEntry } from "@/lib/linked-agenda";
import { Link2 } from "@/components/icons";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryState, parseAsInteger } from "nuqs";
import { Repeat } from "@/components/icons";
import { toast } from "sonner";
import type { AgendaItem, Task, HabitEntry } from "@/lib/schemas";
import { iso, parseTimeToMinutes } from "@/lib/date";
import { deleteMeetingAction } from "@/lib/actions/agenda";
import { meetingsOnDay, meetingTimeRange } from "@/lib/meetings";
import { MeetingDialog } from "@/components/agenda/MeetingDialog";
import {
  MeetingBodyView,
  hasJoinAction,
} from "@/components/agenda/MeetingBodyView";
import { AddMeetingButton } from "@/components/agenda/AddMeetingButton";
import {
  CALENDAR_PRIO,
  calendarPrioBg,
  isMeetingPast,
  isMeetingTask,
  meetingTimeLabel,
  sortCalendarDayTasks,
} from "@/lib/calendar-tasks";
import { TaskList } from "@/components/tasks/TaskList";
import type { Tag } from "@/lib/schemas";
import { Topbar } from "@/components/shell/Topbar";
import { useLifeView } from "@/components/shell/LifeAreaToggle";
import { cn } from "@/lib/utils";
import { useTimezone } from "@/components/shell/TimeZoneProvider";
import { ChevronLeft, ChevronRight } from "@/components/icons";

const PRIO = CALENDAR_PRIO;

type Props = {
  tasks: Task[];
  agenda: AgendaEntry[];
  /** Settings toggle: meeting ID and passcode under each meeting. */
  showMeetingCodes?: boolean;
  habitEntries: HabitEntry[];
  tags: Tag[];
  stats: { dayPct: number; habitsLabel: string; topStreak: number };
  birthDate?: string | null;
  lifeSpanYears?: number;
};

export function CalendarView({
  tasks,
  agenda,
  showMeetingCodes = false,
  habitEntries,
  tags,
  stats,
  birthDate = null,
  lifeSpanYears,
}: Props) {
  const [life] = useLifeView();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const timeZone = useTimezone();
  // Expand repeat rules so a weekly standup lands on every matching day.
  const meetingsFor = (day: string) =>
    meetingsOnDay(agenda, day).map((o) => o.item);
  // Removing from a day removes just that occurrence of a repeating meeting.
  const deleteMeeting = (id: string, date: string) => {
    startTransition(async () => {
      const res = await deleteMeetingAction({ id, scope: "occurrence", date });
      if (!res.ok) toast.error(res.error ?? "Could not remove meeting");
      else router.refresh();
    });
  };
  const [editingMeeting, setEditingMeeting] = useState<AgendaItem | null>(null);
  const td = iso(new Date(), timeZone);
  const [offset, setOffset] = useQueryState(
    "month",
    parseAsInteger.withDefault(0),
  );
  // On small screens the month grid is taller than the viewport — land the
  // user on today's row instead of the top of the month.
  const todayCellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) {
      todayCellRef.current?.scrollIntoView({ block: "center" });
    }
  }, []);
  const [selected, setSelected] = useQueryState("day", {
    defaultValue: td,
  });
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + offset);
  const yy = base.getFullYear();
  const mm = base.getMonth();
  const monthLabel = base.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const firstDow = (new Date(yy, mm, 1).getDay() + 6) % 7;
  const start = new Date(yy, mm, 1);
  start.setDate(1 - firstDow);

  const cells = [...Array(42)].map((_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const ds = iso(d, timeZone);
    const inM = d.getMonth() === mm;
    const dts = sortCalendarDayTasks(
      tasks.filter((t) => (t.due ?? "").slice(0, 10) === ds),
    );
    const meetings = meetingsFor(ds);
    // Cells fit ~3 rows: meetings first (max 2), tasks fill the rest.
    const shownMeetings = Math.min(2, meetings.length);
    const shownTasks = Math.min(dts.length, Math.max(0, 3 - shownMeetings));
    const overflow = meetings.length + dts.length - shownMeetings - shownTasks;
    const hc = habitEntries.filter((e) => e.date === ds).length;
    const isSel = ds === selected;
    const isTdy = ds === td;
    return {
      ds,
      day: d.getDate(),
      inM,
      dts,
      meetings,
      shownMeetings,
      shownTasks,
      overflow,
      hc,
      isSel,
      isTdy,
    };
  });

  const selTasks = tasks.filter((t) => (t.due ?? "").slice(0, 10) === selected);
  const selLabel = new Date(selected + "T00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <Topbar
        title="Calendar"
        dayPct={stats.dayPct}
        habitsLabel={stats.habitsLabel}
        topStreak={stats.topStreak}
        birthDate={birthDate}
        lifeSpanYears={lifeSpanYears}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pb-6 animate-pumma-view lg:flex-row lg:gap-[18px]">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-border bg-surface">
          <div className="flex items-center gap-3 px-5 py-4">
            {/* No min-width. It was 190px, which parked the arrows a fixed
                distance away from a label that is usually much shorter, so
                "October 2026" and its own controls looked unrelated. */}
            <h3 className="m-0 whitespace-nowrap text-lg font-extrabold tracking-tight">
              {monthLabel}
            </h3>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setOffset(offset - 1)}
                aria-label="Previous month"
                className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border text-muted hover:border-faint2"
              >
                <ChevronLeft className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setOffset(offset + 1)}
                aria-label="Next month"
                className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-border text-muted hover:border-faint2"
              >
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setOffset(0);
                setSelected(td);
              }}
              className="rounded-lg border border-border px-[11px] py-1.5 font-mono text-[11px] font-semibold text-muted"
            >
              Today
            </button>
            <div className="ml-auto flex items-center gap-3.5 font-mono text-[10px] text-faint">
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-3 shrink-0 rounded-sm border-l-2 border-primary bg-primary/10"
                  aria-hidden
                />
                meeting
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px] border border-border"
                  aria-hidden
                />
                task
              </span>
              <span className="flex items-center gap-1">
                <span className="h-[5px] w-[5px] rounded-full bg-habits" />
                habit
              </span>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-7 px-4 max-lg:px-3">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div
                key={d}
                className="py-1.5 text-center font-mono text-[10px] text-faint2"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-[5px] px-4 pb-4 max-lg:min-h-0 max-lg:flex-1 max-lg:auto-rows-[minmax(58px,auto)] max-lg:gap-1 max-lg:overflow-y-auto max-lg:px-3 max-lg:pb-3 lg:flex-1 lg:grid-rows-6">
            {cells.map((c) => (
              <div
                key={c.ds}
                ref={c.isTdy ? todayCellRef : undefined}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(c.ds)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(c.ds);
                  }
                }}
                className={cn(
                  "flex min-h-0 cursor-pointer flex-col overflow-hidden rounded-lg border p-[6px_7px] text-left transition-[background-color,border-color,box-shadow] duration-150",
                  // The selected day paints its OWN background and does not
                  // also ask for bg-surface. A global rule in globals.css
                  // sets .bg-surface with !important, so a cell carrying both
                  // kept the plain surface and the selection came down to one
                  // pixel of border, which is why it was hard to see.
                  c.isSel
                    ? "border-primary bg-primary/[0.14] ring-2 ring-inset ring-primary/45"
                    : cn(
                        "border-border2",
                        c.inM ? "bg-surface" : "bg-transparent",
                      ),

                )}
              >
                <div className="mb-0.5 flex items-center gap-1">
                  {/* Today wears a filled disc, at every size.
                      It used to be a coloured NUMBER on desktop and a ring
                      only below lg, so on a wide screen the one date everybody
                      looks for was a slightly different shade of text among
                      forty others. A filled disc reads before you focus on
                      it, and it survives the day also being selected, which a
                      second ring would not. */}
                  <span
                    className={cn(
                      "flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-[3px] text-xs",
                      c.isTdy
                        ? "bg-primary font-bold text-background"
                        : c.inM
                          ? "text-ink"
                          : "text-faint2",
                    )}
                  >
                    {c.day}
                  </span>
                  {c.hc > 0 && (
                    <span className="ml-auto h-[5px] w-[5px] rounded-full bg-habits" />
                  )}
                </div>
                <div className="flex flex-col gap-0.5 overflow-hidden max-lg:hidden">
                  {c.meetings.slice(0, c.shownMeetings).map((m) => (
                    <span
                      key={m.id}
                      className="flex min-w-0 items-center gap-1 truncate rounded border-l-2 px-1 py-px text-[9px]"
                      style={{
                        borderColor: m.color,
                        background: m.color.replace(")", " / 0.1)"),
                      }}
                    >
                      <span className="shrink-0 font-mono text-[8px] text-faint2">
                        {m.time}
                      </span>
                      <span className="min-w-0 truncate font-medium text-ink">
                        {m.title}
                      </span>
                    </span>
                  ))}
                  {c.dts.slice(0, c.shownTasks).map((t) => {
                    if (isMeetingTask(t) && t.due) {
                      const past = isMeetingPast(
                        t.due,
                        c.ds,
                        new Date(),
                        timeZone,
                      );
                      const color = PRIO[t.priority];
                      return (
                        <span
                          key={t.id}
                          className="flex min-w-0 items-center gap-1 truncate rounded border-l-2 px-1 py-px text-[9px]"
                          style={{
                            borderColor: color,
                            background: calendarPrioBg(color),
                          }}
                        >
                          <span className="shrink-0 font-mono text-[8px] text-faint2">
                            {meetingTimeLabel(t.due)}
                          </span>
                          <span
                            className={cn(
                              "min-w-0 truncate font-medium",
                              past ? "text-faint line-through" : "text-ink",
                            )}
                          >
                            {t.title}
                          </span>
                        </span>
                      );
                    }
                    const done = t.status === "done";
                    return (
                      <span
                        key={t.id}
                        className="flex min-w-0 items-center gap-1 truncate text-[9px]"
                      >
                        <span
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-[3px] border-[1.5px]",
                            done ? "border-none bg-habits" : "border-border",
                          )}
                          aria-hidden
                        />
                        <span
                          className={cn(
                            "min-w-0 truncate",
                            done ? "text-faint line-through" : "text-ink",
                          )}
                        >
                          {t.title}
                        </span>
                      </span>
                    );
                  })}
                  {c.overflow > 0 && (
                    <span className="font-mono text-[9px] text-faint">
                      +{c.overflow} more
                    </span>
                  )}
                </div>
                {/* Phone cells are too narrow for text — one colored dot per
                    meeting/task, tap the day to read them in the panel. */}
                <div className="mt-auto flex flex-wrap content-end items-center gap-[3px] pt-0.5 lg:hidden">
                  {[
                    ...c.meetings.map((m) => m.color),
                    ...c.dts.map((t) =>
                      t.status === "done"
                        ? "oklch(0.6 0.13 155 / 0.55)"
                        : PRIO[t.priority],
                    ),
                  ]
                    .slice(0, 4)
                    .map((col, i) => (
                      <span
                        key={i}
                        className="h-[5px] w-[5px] rounded-full"
                        style={{ background: col }}
                      />
                    ))}
                  {c.meetings.length + c.dts.length > 4 && (
                    <span className="font-mono text-[8px] leading-none text-faint">
                      +{c.meetings.length + c.dts.length - 4}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col overflow-hidden rounded-[14px] border border-border bg-surface max-lg:h-[38dvh] max-lg:shrink-0 lg:w-[300px]">
          <div className="flex items-start justify-between gap-2 border-b border-border2 px-[18px] py-4">
            <div className="min-w-0">
              <div className="mb-0.5 font-mono text-[10px] text-faint">
                SELECTED DAY
              </div>
              <h3 className="m-0 text-base font-bold">{selLabel}</h3>
            </div>
            <AddMeetingButton
              defaultDate={selected}
              lifeView={life}
              className="mt-0.5 shrink-0"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-[18px] py-3.5 max-lg:pb-24">
            {meetingsFor(selected).length > 0 && (
              <div className="mb-2 flex flex-col gap-0.5">
                {meetingsFor(selected).map((m) => (
                  <div
                    key={m.id}
                    className="group relative -mx-1 rounded-lg px-1 py-1"
                  >
                    <button
                      type="button"
                      // A mirrored event has nothing to edit: it belongs to
                      // another calendar and PUMMA only reads it.
                      onClick={() => !isLinked(m) && setEditingMeeting(m)}
                      className={cn(
                        "flex w-full gap-2 text-left",
                        isLinked(m) && "cursor-default",
                      )}
                    >
                      <span className="w-10 shrink-0 pt-px font-mono text-[11px] text-faint2">
                        {m.time}
                      </span>
                      <div
                        className="min-w-0 flex-1 border-l-2 pl-[11px]"
                        style={{ borderColor: m.color }}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="min-w-0 truncate text-[13px] font-semibold">
                            {m.title}
                          </span>
                          {m.recurrence && (
                            <Repeat
                              className="h-2.5 w-2.5 shrink-0 text-faint2"
                              aria-label="Repeats"
                            />
                          )}
                        </div>
                        <div className="text-[11px] text-faint">
                          {/* An all-day event has no clock time, and running
                              "all day" through a HH:MM formatter is where
                              "NaN:NaN to NaN:NaN" came from. */}
                          {m.time === ALL_DAY_LABEL
                            ? "All day"
                            : meetingTimeRange(m.time, m.durationMins)}
                        </div>
                      </div>
                    </button>
                    {/* Outside the button: a join link inside a button is a
                        link you cannot click.

                        The chain rides on the body's own action row so it
                        lines up with the join button rather than floating
                        against the middle of a row whose height depends on
                        how much invite there was. */}
                    <MeetingBodyView
                      notes={m.notes}
                      compact
                      showCodes={showMeetingCodes}
                      className="ml-[52px] mt-1.5"
                      trailing={
                        isLinked(m) && hasJoinAction(m.notes) ? (
                          // Beside the join button when there is one. Not a
                          // button itself: the only way to remove it is to
                          // stop reading the calendar it comes from, which
                          // lives in Settings.
                          <span
                            title={`From ${m.linkedTo}`}
                            className="flex h-6 w-6 items-center justify-center text-faint2"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </span>
                        ) : undefined
                      }
                    />
                    {/* No join button to sit beside, so it takes the middle of
                        the row, exactly where a delete would be. */}
                    {isLinked(m) && !hasJoinAction(m.notes) && (
                      <span
                        title={`From ${m.linkedTo}`}
                        className="absolute right-0 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-faint2"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {!isLinked(m) && (
                      <DeleteButton
                        onClick={() => deleteMeeting(m.id, selected)}
                        label={`Delete meeting ${m.title}`}
                        revealOnHover
                        className="absolute right-0 top-1/2 -translate-y-1/2"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
            {selTasks.length ? (
              <TaskList
                tasks={selTasks}
                tags={tags}
                variant="calendar"
                calendarDay={selected}
                linkTaskDetail
                lifeView={life}
              />
            ) : meetingsFor(selected).length === 0 ? (
              <div className="px-1 py-2 text-[13px] text-faint">
                Nothing scheduled. Add a meeting above or capture a task.
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {editingMeeting && (
        <MeetingDialog
          open
          onOpenChange={(o) => !o && setEditingMeeting(null)}
          defaultDate={selected}
          lifeView={life}
          meeting={editingMeeting}
          occurrenceDate={selected}
        />
      )}
    </>
  );
}
