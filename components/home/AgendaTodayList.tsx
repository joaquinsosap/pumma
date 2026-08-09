"use client";
import { DeleteButton } from "@/components/ui/delete-button";

import { useEffect, useMemo, useState } from "react";
import type { AgendaItem } from "@/lib/schemas";
import { formatTimeHM, parseTimeToMinutes } from "@/lib/date";
import { useTimezone } from "@/components/shell/TimeZoneProvider";
import {
  buildAgendaBlocks,
  findNowPlacement,
  formatDeadTimeLabel,
  type NowPlacement,
} from "@/lib/agenda-timeline";
import { WidgetRowLink } from "@/components/home/WidgetLink";
import { cn } from "@/lib/utils";

function AgendaNowLine({ time }: { time: string }) {
  return (
    <div
      className="pointer-events-none relative z-10 flex items-center gap-2 py-0.5"
      aria-label={`Current time ${time}`}
    >
      <span className="w-10 shrink-0 font-mono text-[10px] font-bold text-primary">
        {time}
      </span>
      <div className="flex min-w-0 flex-1 items-center">
        <span className="h-2 w-2 shrink-0 rounded-full bg-primary shadow-[0_0_0_2px_var(--surface)]" />
        <span className="h-px min-w-0 flex-1 bg-primary" />
      </div>
    </div>
  );
}

function DeadTimeRow({
  startMins,
  endMins,
  remainingMins,
  nextTime,
  showNowLine,
  nowLabel,
}: {
  startMins: number;
  endMins: number;
  remainingMins: number;
  nextTime: string;
  showNowLine: boolean;
  nowLabel: string;
}) {
  const label = formatDeadTimeLabel(
    startMins,
    endMins,
    showNowLine,
    remainingMins,
    nextTime,
  );

  return (
    <div className="relative my-0.5 min-h-[24px]">
      <div className="flex items-center gap-2 py-0.5">
        <span className="w-10 shrink-0 text-center font-mono text-[9px] text-faint2">
          ···
        </span>
        <div className="min-w-0 flex-1 border-l border-dashed border-faint2/50 py-0.5 pl-3">
          <span className="font-mono text-[9px] font-medium uppercase tracking-widest text-faint2">
            dead time
          </span>
          <span className="ml-1.5 font-mono text-[9px] text-faint">
            {label}
          </span>
        </div>
      </div>
      {showNowLine && (
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-1">
          <AgendaNowLine time={nowLabel} />
        </div>
      )}
    </div>
  );
}

function AgendaEventRow({
  ev,
  href,
  active,
  showNowLine,
  nowProgress,
  nowLabel,
  onDelete,
}: {
  ev: AgendaItem;
  href: string;
  active: boolean;
  showNowLine?: boolean;
  nowProgress?: number;
  nowLabel: string;
  onDelete?: (id: string) => void;
}) {
  const deletable = onDelete && ev.kind === "meeting";
  return (
    <div className="group relative">
      <WidgetRowLink href={href}>
        <div className="flex gap-2">
          <span
            className={cn(
              "w-10 shrink-0 pt-px font-mono text-[11px]",
              active ? "font-semibold text-ink" : "text-faint2",
            )}
          >
            {ev.time}
          </span>
          <div
            className={cn(
              "flex-1 border-l-2",
              active
                ? "rounded-r-lg bg-tasks/[0.07] py-1 pl-3"
                : "py-0 pl-[11px]",
            )}
            style={{ borderColor: ev.color }}
          >
            <div className="text-[13px] font-semibold">{ev.title}</div>
            <div
              className={cn(
                "text-[11px]",
                active ? "text-tasks/80" : "text-faint",
              )}
            >
              {ev.sub}
            </div>
          </div>
        </div>
      </WidgetRowLink>
      {deletable && (
        <DeleteButton
          onClick={() => onDelete(ev.id)}
          label={`Delete meeting ${ev.title}`}
          revealOnHover
          className="absolute right-0 top-1/2 -translate-y-1/2"
        />
      )}
      {showNowLine && (
        <div
          className="pointer-events-none absolute inset-x-0 px-1"
          style={{
            top: `${Math.min(Math.max((nowProgress ?? 0.5) * 100, 8), 92)}%`,
            transform: "translateY(-50%)",
          }}
        >
          <AgendaNowLine time={nowLabel} />
        </div>
      )}
    </div>
  );
}

type Props = {
  agenda: AgendaItem[];
  href: string;
  live?: boolean;
  onDeleteItem?: (id: string) => void;
};

export function AgendaTodayList({
  agenda,
  href,
  live = false,
  onDeleteItem,
}: Props) {
  const timeZone = useTimezone();
  const [nowLabel, setNowLabel] = useState(() =>
    formatTimeHM(new Date(), timeZone),
  );

  useEffect(() => {
    if (!live) return;
    const tick = () => setNowLabel(formatTimeHM(new Date(), timeZone));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [live, timeZone]);

  const blocks = useMemo(() => buildAgendaBlocks(agenda), [agenda]);
  const nowMins = live ? parseTimeToMinutes(nowLabel) : -1;
  const placement: NowPlacement | null = live
    ? findNowPlacement(blocks, nowMins)
    : null;

  if (!blocks.length) {
    return (
      <p className="py-2 font-mono text-[11px] text-faint2">
        Nothing scheduled
      </p>
    );
  }

  return (
    <div className="relative mb-4 flex flex-1 flex-col gap-0.5">
      {live && placement?.kind === "before" && (
        <AgendaNowLine time={nowLabel} />
      )}
      {blocks.map((block, i) => {
        if (block.type === "dead") {
          const isActive =
            placement?.kind === "dead" && placement.blockIndex === i;
          const remaining = block.endMins - nowMins;
          return (
            <DeadTimeRow
              key={`dead-${block.startMins}`}
              startMins={block.startMins}
              endMins={block.endMins}
              remainingMins={remaining}
              nextTime={block.nextTime}
              nowLabel={nowLabel}
              showNowLine={isActive}
            />
          );
        }

        const active =
          live && placement?.kind === "event" && placement.blockIndex === i;
        const showNowLine = active;
        const nowProgress =
          placement?.kind === "event" && placement.blockIndex === i
            ? placement.progress
            : undefined;

        return (
          <AgendaEventRow
            key={block.item.id}
            ev={block.item}
            href={href}
            active={Boolean(active)}
            nowLabel={nowLabel}
            showNowLine={showNowLine}
            nowProgress={nowProgress}
            onDelete={onDeleteItem}
          />
        );
      })}
      {live && placement?.kind === "after" && <AgendaNowLine time={nowLabel} />}
    </div>
  );
}
