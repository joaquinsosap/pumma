"use client";

import { useTransition } from "react";
import { Square } from "@/components/icons";
import { stopTaskTimer } from "@/lib/actions/task-timer";
import { formatDurationClock, taskElapsedSec } from "@/lib/time";
import { useNow, useTaskTimer } from "@/components/tasks/TaskTimerProvider";
import { cn } from "@/lib/utils";

export function ActiveTaskTimer({ className }: { className?: string }) {
  const { runningTask } = useTaskTimer();
  const now = useNow(Boolean(runningTask));
  const [pending, startTransition] = useTransition();

  const elapsed = runningTask ? taskElapsedSec(runningTask, now) : 0;

  const handleStop = () => {
    if (!runningTask) return;
    startTransition(async () => {
      // stopTaskTimer revalidates the route → runningTask clears on its own.
      await stopTaskTimer(runningTask.id);
    });
  };

  return (
    <div
      className={cn(
        "flex h-8 items-center gap-2 overflow-hidden rounded-lg border px-2.5 transition-[max-width,opacity,border-color] duration-200",
        runningTask
          ? "max-w-[min(340px,42vw)] border-primary/35 bg-primary/[0.08] opacity-100"
          : "max-w-0 border-transparent p-0 opacity-0",
        className,
      )}
      style={
        runningTask
          ? { boxShadow: "2px 2px 0 oklch(0.55 0.16 274 / 0.18)" }
          : undefined
      }
      aria-hidden={!runningTask}
    >
      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
      <span className="min-w-0 truncate text-[12px] font-semibold text-ink">
        {runningTask?.title ?? "\u00a0"}
      </span>
      <span className="shrink-0 font-mono text-[11px] font-bold tabular-nums text-primary">
        {runningTask ? formatDurationClock(elapsed) : "0:00"}
      </span>
      <button
        type="button"
        disabled={pending || !runningTask}
        onClick={handleStop}
        tabIndex={runningTask ? 0 : -1}
        className="flex shrink-0 items-center justify-center rounded-md border border-primary/40 bg-primary/15 p-1 text-primary hover:bg-primary/25 disabled:opacity-50"
        title="Stop timer"
      >
        <Square className="h-2.5 w-2.5" fill="currentColor" />
      </button>
    </div>
  );
}
