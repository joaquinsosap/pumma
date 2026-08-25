"use client";
import { DeleteButton } from "@/components/ui/delete-button";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryState } from "nuqs";
import { Repeat } from "@/components/icons";
import { toast } from "sonner";
import {
  iso,
  weekDates,
  dowLetters,
  parseTimeToMinutes,
  type WeekStart,
} from "@/lib/date";
import type { AgendaItem, Task } from "@/lib/schemas";
import { deleteMeetingAction } from "@/lib/actions/agenda";
import { meetingsOnDay, meetingTimeRange } from "@/lib/meetings";
import { MeetingDialog } from "@/components/agenda/MeetingDialog";
import { WidgetHeader, WidgetHeaderLink } from "@/components/home/WidgetLink";
import { AgendaTodayList } from "@/components/home/AgendaTodayList";
import { AddMeetingButton } from "@/components/agenda/AddMeetingButton";
import { cn } from "@/lib/utils";
import { hrefWithLife, type LifeView } from "@/lib/life-area";
import { taskDetailHref } from "@/lib/task-links";
import { Taggable } from "@/components/tags/TagMenuProvider";
import { useTimezone } from "@/components/shell/TimeZoneProvider";

const PRIO_COLOR = {
  high: "var(--prio-high)",
  med: "var(--prio-med)",
  low: "var(--prio-low)",
} as const;

function taskTimeLabel(due: string | null): string {
  if (!due) return "—";
  if (due.includes("T")) return due.split("T")[1]?.slice(0, 5) ?? "—";
  return "all day";
}

function taskSortKey(due: string | null): number {
  if (!due?.includes("T")) return 9999;
  return parseTimeToMinutes(due.split("T")[1] ?? "00:00");
}

function AgendaDayTasks({
  tasks,
  lifeView,
  today,
}: {
  tasks: Task[];
  lifeView: LifeView;
  today: string;
}) {
  const sorted = [...tasks].sort(
    (a, b) => taskSortKey(a.due) - taskSortKey(b.due),
  );

  if (!sorted.length) {
    return (
      <p className="py-2 font-mono text-[11px] text-faint2">
        Nothing scheduled
      </p>
    );
  }

  return (
    <div className="mb-4 flex flex-1 flex-col gap-0.5">
      {sorted.map((task) => (
        <Taggable
          key={task.id}
          entity="task"
          id={task.id}
          tagIds={task.tagIds}
          lifeArea={task.lifeArea}
        >
          <Link
            href={taskDetailHref(task, lifeView, today)}
            className="-mx-1 block rounded-lg px-1 py-0.5 transition-colors hover:bg-hover"
          >
            <div className="flex gap-2">
              <span className="w-10 shrink-0 pt-px font-mono text-[11px] text-faint2">
                {taskTimeLabel(task.due)}
              </span>
              <div
                className="flex-1 border-l-2 py-0 pl-[11px]"
                style={{ borderColor: PRIO_COLOR[task.priority] }}
              >
                <div className="text-[13px] font-semibold">{task.title}</div>
                <div className="text-[11px] capitalize text-faint">
                  {task.status} · {task.priority}
                </div>
              </div>
            </div>
          </Link>
        </Taggable>
      ))}
    </div>
  );
}

type Props = {
  agenda: AgendaItem[];
  tasks: Task[];
  lifeView: LifeView;
  weekStart?: WeekStart;
};

export function AgendaPanel({
  agenda,
  tasks,
  lifeView,
  weekStart = "mon",
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const timeZone = useTimezone();
  const td = iso(new Date(), timeZone);
  const [selectedDay, setSelectedDay] = useQueryState("day", {
    defaultValue: td,
  });

  // Meetings are expanded from their repeat rules, so a weekly standup shows
  // up on every matching day without a row per occurrence in the database.
  const occurrencesFor = (day: string) => meetingsOnDay(agenda, day);
  const agendaFor = (day: string) => occurrencesFor(day).map((o) => o.item);

  // Editing/removing always targets the clicked DAY, so "delete this one" on a
  // repeating meeting skips just that date.
  const [editing, setEditing] = useState<{
    item: AgendaItem;
    date: string;
  } | null>(null);

  const deleteOccurrence = (id: string, date: string) => {
    startTransition(async () => {
      const res = await deleteMeetingAction({ id, scope: "occurrence", date });
      if (!res.ok) toast.error(res.error ?? "Could not remove meeting");
      else router.refresh();
    });
  };
  const week = weekDates(new Date(), weekStart, timeZone);
  const letters = dowLetters(weekStart);
  const isToday = selectedDay === td;
  const calendarHref = hrefWithLife(`/calendar?day=${selectedDay}`, lifeView);

  const selectedDate = new Date(selectedDay + "T00:00");
  const headerDate = selectedDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const sectionLabel = isToday
    ? "TODAY"
    : selectedDate
        .toLocaleDateString("en-US", { weekday: "short" })
        .toUpperCase();

  const dayTasks = tasks.filter(
    (t) => (t.due ?? "").slice(0, 10) === selectedDay,
  );

  return (
    <section className="flex flex-col overflow-hidden rounded-[13px] border border-border bg-surface max-xl:max-h-[70vh] max-xl:shrink-0">
      <div className="px-4 pb-3 pt-[15px]">
        <WidgetHeader accent="primary" className="-mx-4 px-4">
          <div className="min-w-0 flex-1">
            <WidgetHeaderLink href={calendarHref}>
              <h3 className="m-0 text-sm font-bold">Agenda</h3>
              <span className="ml-auto font-mono text-[11px] text-faint">
                {headerDate}
              </span>
            </WidgetHeaderLink>
          </div>
          <AddMeetingButton
            defaultDate={selectedDay}
            lifeView={lifeView}
            className="shrink-0"
          />
        </WidgetHeader>
        <div className="grid grid-cols-7 gap-1">
          {week.map((d, i) => (
            <div
              key={`dow-${iso(d, timeZone)}`}
              className="text-center font-mono text-[9px] text-faint2"
            >
              {letters[i]}
            </div>
          ))}
          {week.map((d) => {
            const dayIso = iso(d, timeZone);
            const isSelected = dayIso === selectedDay;
            const isDayToday = dayIso === td;
            return (
              <button
                key={`day-${dayIso}`}
                type="button"
                onClick={() => setSelectedDay(dayIso)}
                className={cn(
                  "rounded-lg py-1.5 text-center text-xs transition-colors",
                  isSelected
                    ? "bg-ink font-bold text-background"
                    : isDayToday
                      ? "font-semibold text-ink ring-1 ring-border hover:bg-hover"
                      : "font-normal text-muted hover:bg-hover",
                )}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-1 flex-col overflow-y-auto px-4 pb-3.5">
        <div className="mb-2.5 flex items-center gap-2">
          <Link
            href={calendarHref}
            className="inline-block font-mono text-[10px] tracking-widest text-faint2 transition-colors hover:text-faint"
          >
            {sectionLabel}
          </Link>
        </div>
        {isToday ? (
          <AgendaTodayList
            agenda={agendaFor(td)}
            href={calendarHref}
            live
            onDeleteItem={(id) => deleteOccurrence(id, td)}
          />
        ) : (
          <>
            <DayMeetings
              meetings={agendaFor(selectedDay)}
              onDelete={(id) => deleteOccurrence(id, selectedDay)}
              onEdit={(item) => setEditing({ item, date: selectedDay })}
            />
            <AgendaDayTasks tasks={dayTasks} lifeView={lifeView} today={td} />
          </>
        )}
      </div>
      {editing && (
        <MeetingDialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          defaultDate={editing.date}
          lifeView={lifeView}
          meeting={editing.item}
          occurrenceDate={editing.date}
        />
      )}
    </section>
  );
}

/** Dated meetings shown on a non-today day, above that day's tasks. */
function DayMeetings({
  meetings,
  onDelete,
  onEdit,
}: {
  meetings: AgendaItem[];
  onDelete: (id: string) => void;
  onEdit: (item: AgendaItem) => void;
}) {
  if (!meetings.length) return null;
  const sorted = [...meetings].sort(
    (a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time),
  );
  return (
    <div className="mb-2 flex flex-col gap-0.5">
      {sorted.map((m) => (
        <div key={m.id} className="group relative -mx-1 rounded-lg px-1 py-0.5">
          <button
            type="button"
            onClick={() => onEdit(m)}
            className="flex w-full gap-2 text-left"
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
                {meetingTimeRange(m.time, m.durationMins)}
                {m.notes ? ` · ${m.notes}` : ""}
              </div>
            </div>
          </button>
          <DeleteButton
            onClick={() => onDelete(m.id)}
            label={`Delete meeting ${m.title}`}
            revealOnHover
            className="absolute right-0 top-1/2 -translate-y-1/2"
          />
        </div>
      ))}
    </div>
  );
}
