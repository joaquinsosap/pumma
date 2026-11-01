"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/schemas";
import { serverAnswers } from "@/lib/lost-connection";

type TaskTimerContextValue = {
  runningTask: Task | null;
};

const TaskTimerContext = createContext<TaskTimerContextValue>({
  runningTask: null,
});

/**
 * Provides only the (rarely-changing) running task + a focus/visibility resync.
 * The per-second clock deliberately lives in {@link useNow}, NOT here: putting
 * `now` in context re-rendered every TaskTimer chip in every list once a second
 * even when nothing about them changed. Now only the components that actually
 * display a live clock (the running chip + the topbar) tick.
 */
export function TaskTimerProvider({
  tasks,
  children,
}: {
  tasks: Task[];
  children: ReactNode;
}) {
  const router = useRouter();
  const runningTask = tasks.find((t) => t.timerStartedAt) ?? null;

  useEffect(() => {
    const refresh = () => {
      void serverAnswers().then((up) => {
        if (up) router.refresh();
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  return (
    <TaskTimerContext.Provider value={{ runningTask }}>
      {children}
    </TaskTimerContext.Provider>
  );
}

export function useTaskTimer() {
  return useContext(TaskTimerContext);
}

/**
 * A 1s clock that ticks ONLY while `active`. Inactive callers never re-render
 * on the interval — a non-running timer chip's display doesn't depend on `now`
 * (its elapsed is just its stored time), so it should stay perfectly still.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}
