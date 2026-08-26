"use client";
import { DeleteButton } from "@/components/ui/delete-button";

import { useEffect, useMemo, useState } from "react";
import { isLinked, type AgendaEntry } from "@/lib/linked-agenda";
import { Link2, Video } from "@/components/icons";
import { parseMeetingBody } from "@/lib/meeting-body";
import { formatTimeHM, parseTimeToMinutes } from "@/lib/date";
import { useTimezone } from "@/components/shell/TimeZoneProvider";
import {
  buildAgendaBlocks,
  findNowPlacement,
  formatDeadTimeLabel,
  formatRemainingMinutes,
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
        <div className="flex min-w-0 flex-1 items-baseline border-l border-dashed border-faint2/50 py-0.5 pl-3">
          <span className="font-mono text-[9px] font-medium uppercase tracking-widest text-faint2">
            dead time
          </span>
          <span className="ml-1.5 truncate font-mono text-[9px] text-faint">
            {label}
          </span>
          {/* How big the window is, right beside the times rather than pinned
              to the far edge — at the edge it read as a separate column of
              data instead of the answer to the sentence next to it. Darker
              than the range too: the times are reference, this is the number
              you are actually looking for when you wonder whether something
              fits.

              Only on the idle form. The active row already counts down to
              the next thing, and two durations on one line is a riddle. */}
          {!showNowLine && (
            <span className="ml-1 shrink-0 font-mono text-[9px] font-semibold text-muted">
              ({formatRemainingMinutes(endMins - startMins)})
            </span>
          )}
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
  ev: AgendaEntry;
  href: string;
  active: boolean;
  showNowLine?: boolean;
  nowProgress?: number;
  nowLabel: string;
  onDelete?: (id: string) => void;
}) {
  // A mirrored event has no delete: it is a reflection of something owned in
  // another calendar, and deleting the reflection would either lie (it comes
  // back next sync) or overreach (we do not write to their calendar). The
  // chain takes the same spot so the row keeps its shape, and says where it
  // came from on hover.
  const linked = isLinked(ev);
  // Only meetings carry an invite worth scanning for a call.
  const join =
    ev.kind === "meeting" ? parseMeetingBody(ev.notes ?? "").conference : null;
  const deletable = onDelete && ev.kind === "meeting" && !linked;
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
      {/* Icon only. This widget is a column of rows in the narrowest part of
          the page, and a "Join Teams meeting" button would cost more width
          than the meeting title it belongs to. */}
      {join && (
        <a
          href={join.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={join.label}
          aria-label={join.label}
          className={cn(
            "absolute top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-white transition-opacity hover:opacity-90",
            // Sits inboard of the chain when there is one, so the two never
            // stack on the same pixel.
            linked ? "right-[26px]" : "right-0",
          )}
          style={{ background: "var(--primary)" }}
        >
          <Video className="h-3 w-3" />
        </a>
      )}
      {linked && (
        <span
          aria-hidden
          title={`From ${ev.linkedTo}`}
          className="absolute right-0 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-faint2"
        >
          <Link2 className="h-3.5 w-3.5" />
        </span>
      )}
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
  agenda: AgendaEntry[];
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
