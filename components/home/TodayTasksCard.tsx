"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import type { Task, Tag } from "@/lib/schemas";
import { TaskList } from "@/components/tasks/TaskList";
import { CarryoverSection } from "@/components/tasks/CarryoverSection";
import { WidgetHeader, WidgetHeaderLink } from "@/components/home/WidgetLink";
import { addDays, iso } from "@/lib/date";
import { type LifeView } from "@/lib/life-area";
import { taskDetailHref, tasksListHref } from "@/lib/task-links";
import { sortTasksByPriority } from "@/lib/task-order";
import { useTimezone } from "@/components/shell/TimeZoneProvider";
import { cn } from "@/lib/utils";

/** Carryover window: overdue tasks older than this stop nagging here. */
const CARRYOVER_DAYS = 7;

/**
 * The home "Today's tasks" widget: day pager (‹ › + Today) to peek at other
 * days, and last week's unfinished carryover — shown only on the real today.
 * The browsed day is plain state on purpose: refreshes land back on today.
 */
export function TodayTasksCard({
  allTasks,
  carryover,
  tags,
  lifeView,
  today: td,
}: {
  allTasks: Task[];
  carryover: Task[];
  tags: Tag[];
  lifeView: LifeView;
  today: string;
}) {
  const timeZone = useTimezone();
  const [day, setDay] = useState(td);
  const onToday = day === td;

  const stepDay = (delta: number) =>
    setDay((d) =>
      iso(addDays(delta, new Date(d + "T00:00"), timeZone), timeZone),
    );

  // Highest priority first — this widget is the "what should I do next" glance,
  // so the answer belongs at the top rather than wherever capture order put it.
  const dayTasks = sortTasksByPriority(
    allTasks.filter((t) => (t.due ?? "").slice(0, 10) === day),
  );
  const done = dayTasks.filter((t) => t.status === "done").length;
  const pct = dayTasks.length ? Math.round((done / dayTasks.length) * 100) : 0;

  const carryoverCutoff = iso(
    addDays(-CARRYOVER_DAYS, new Date(), timeZone),
    timeZone,
  );
  const recentCarryover = sortTasksByPriority(
    carryover.filter((t) => (t.due ?? "").slice(0, 10) >= carryoverCutoff),
  );

  const dayLabel = new Date(day + "T00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <section className="flex min-h-0 flex-col rounded-[13px] border border-border bg-surface px-[18px] py-[15px] max-xl:flex-none xl:flex-[1.15]">
      <WidgetHeader accent="tasks">
        <div className="min-w-0 flex-1">
          <WidgetHeaderLink href={tasksListHref(lifeView, "today")}>
            <span className="h-2.5 w-2.5 rounded-[3px] bg-tasks" />
            <h3 className="m-0 truncate text-sm font-bold">
              {onToday ? "Today's tasks" : dayLabel}
            </h3>
            {/* Never wraps: two lines here make the titlebar taller than
                every other panel's and squeeze the title into an ellipsis. */}
            <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-faint">
              {done} of {dayTasks.length} done
            </span>
            {onToday && (
              <div className="ml-auto h-1.5 max-w-[90px] flex-1 overflow-hidden rounded-full bg-border2">
                <div
                  className="h-full bg-tasks transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </WidgetHeaderLink>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!onToday && (
            <button
              type="button"
              onClick={() => setDay(td)}
              className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted transition-colors hover:border-faint2 hover:text-ink"
            >
              Today
            </button>
          )}
          <button
            type="button"
            onClick={() => stepDay(-1)}
            aria-label="Previous day"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-muted transition-colors hover:border-faint2 hover:text-ink"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => stepDay(1)}
            aria-label="Next day"
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-muted transition-colors hover:border-faint2 hover:text-ink"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </WidgetHeader>
      {/* Outside the scroller, on purpose. It hangs off the titlebar, so it
          has to stay hung off it while the list moves underneath. Inside, it
          scrolled away like a first row, and it was also held back from the
          right edge by the scrollbar gutter, which left the "straight sides
          continuing down from the bar" straight on one side only. */}
      {onToday && recentCarryover.length > 0 && (
        <CarryoverSection
          tasks={recentCarryover}
          variant="agenda"
          href={tasksListHref(lifeView, "today")}
          taskHref={(task) => taskDetailHref(task, lifeView, td)}
          className="mb-2 shrink-0"
        />
      )}
      <div className="min-h-0 flex-1 max-lg:overflow-visible @container @max-[470px]:[&_.task-tag-full]:hidden @max-[470px]:[&_.task-tag-mini]:inline @max-[360px]:[&_.task-tag-mini]:!hidden @max-[470px]:[&_.task-subcount-inline]:hidden @max-[470px]:[&_.task-subcount-side]:inline @max-[470px]:[&_.task-time-chip]:hidden @max-[470px]:[&_.task-prio-text]:!hidden @max-[470px]:[&_.task-prio-icon]:!inline-flex @max-[470px]:[&_.task-row]:!grid-cols-[18px_16px_minmax(0,1fr)_28px_44px] @[470px]:[&_.task-timer-cell]:justify-start xl:overflow-y-auto">
        {dayTasks.length ? (
          <TaskList
            tasks={dayTasks}
            tags={tags}
            linkTaskDetail
            lifeView={lifeView}
          />
        ) : (
          <p className={cn("py-2 font-mono text-[11px] text-faint2")}>
            {onToday ? "Nothing due today" : "Nothing was due this day"}
          </p>
        )}
      </div>
    </section>
  );
}
