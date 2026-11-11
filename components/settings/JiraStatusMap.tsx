"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { saveJiraStatusMapAction } from "@/lib/actions/jira";
import {
  COLUMNS,
  columnOfStatus,
  knownInOrder,
  withAnswer,
  type JiraStatusMap as StatusMap,
} from "@/lib/jira/status-map";
import type { StatusesRead } from "@/lib/jira/statuses-server";
import type { TaskColumn } from "@/lib/jira/status-sync";
import { trySave } from "@/lib/try-save";
import { cn } from "@/lib/utils";

const COLUMN_NAME: Record<TaskColumn, string> = {
  todo: "To do",
  doing: "Doing",
  done: "Done",
};
const COLUMN_DOT: Record<TaskColumn, string> = {
  todo: "bg-faint",
  doing: "bg-projects",
  done: "bg-habits",
};
const LEAVE = "";

const heading = "m-0 text-[13px] font-semibold text-ink";
const sub = "m-0 mb-3 mt-0.5 text-[12px] text-faint";

/**
 * The two status tables under the Jira connection: where each Jira status
 * lands here, and which Jira status each column sends back.
 *
 * Every change saves at once. The list of statuses is Jira's: it grows from
 * the button and from every read of a project, never typed here.
 */
export function JiraStatusMap({ map: savedMap }: { map: StatusMap }) {
  const router = useRouter();
  const [map, setMap] = useState(savedMap);
  const [reading, setReading] = useState(false);
  const [readLine, setReadLine] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  useEffect(() => setMap(savedMap), [savedMap]);

  const statuses = knownInOrder(map);

  const save = (next: StatusMap) => {
    const before = map;
    setMap(next);
    startTransition(async () => {
      await trySave(
        () => saveJiraStatusMapAction({ from: next.from, to: next.to }),
        () => setMap(before),
      );
    });
  };

  const read = async () => {
    setReading(true);
    setReadLine(null);
    try {
      const res = await fetch("/api/jira/statuses", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const result = (await res.json()) as StatusesRead;
      if (result.state === "ok") {
        setMap((was) => ({ ...was, known: result.map.known }));
        setReadLine(
          `${result.found} ${result.found === 1 ? "status" : "statuses"}, from the ${
            result.projects === 1 ? "Jira project" : `${result.projects} Jira projects`
          } your tickets sit in.`,
        );
        router.refresh();
      } else if (result.state === "waiting") {
        toast("Jira was read a moment ago. Try again in a minute.");
      } else if (result.state === "nothing") {
        toast("No task or project holds a ticket of this Jira yet.");
      } else if (result.state === "failed") {
        toast.error(result.error);
      } else {
        toast.error("No Jira is connected.");
      }
    } catch {
      toast.error("PUMMA's server did not answer. Try again.");
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="mt-6 flex max-w-xl flex-col gap-6 border-t border-border2 pt-5">
      <div>
        <h3 className={heading}>Where each Jira status lands</h3>
        <p className={sub}>
          When a ticket moves in Jira, its task goes to the column set here. It
          starts as Jira&apos;s own sorting; change any row.
        </p>
        {statuses.length === 0 ? (
          <p className="m-0 rounded-[10px] border border-dashed border-border px-3 py-4 text-center text-[12px] text-faint">
            No statuses yet. Read them from Jira, or open a project that holds
            tickets.
          </p>
        ) : (
          <div className="overflow-hidden rounded-[10px] border border-border">
            {statuses.map((status) => {
              const lands = columnOfStatus(map, status.name);
              const moved = status.stage !== null && lands !== status.stage;
              return (
                <div
                  key={status.name}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border2 px-3 py-2 first:border-t-0"
                >
                  <span className="min-w-0 flex-1 text-[13px] font-semibold text-ink">
                    {status.name}
                    {moved && status.stage && (
                      <span className="ml-1.5 text-[11.5px] font-normal text-faint">
                        Jira sorts it under {COLUMN_NAME[status.stage]}
                      </span>
                    )}
                  </span>
                  <div
                    role="radiogroup"
                    aria-label={`Where ${status.name} lands`}
                    className="flex shrink-0 gap-1"
                  >
                    {COLUMNS.map((column) => {
                      const on = lands === column;
                      return (
                        <button
                          key={column}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => {
                            if (!on) save(withAnswer(map, status.name, column));
                          }}
                          className={cn(
                            "rounded-[7px] border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                            // Off keeps the theme's standard control face; on drops it for the accent.
                            on
                              ? "border-primary bg-primary/[0.12] text-primary"
                              : "border-border bg-surface",
                          )}
                        >
                          {COLUMN_NAME[column]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button variant="outline" onClick={() => void read()} disabled={reading}>
            {reading ? "Reading Jira" : "Read statuses from Jira"}
          </Button>
          <span className="text-[12px] text-faint">
            {readLine ?? "Read only when you press this."}
          </span>
        </div>
      </div>

      <div>
        <h3 className={heading}>What moving a task sends</h3>
        <p className={sub}>
          Move a task that holds a ticket into a column, and its ticket goes to
          the status set here. All three start on Leave Jira alone, so nothing
          is written to Jira until you pick.
        </p>
        <div className="overflow-hidden rounded-[10px] border border-border">
          {COLUMNS.map((column) => {
            const picked = map.to[column];
            // A status picked before the list lost it stays a choice, so the box never shows something it was not set to.
            const names = statuses.map((s) => s.name);
            if (picked && !names.includes(picked)) names.unshift(picked);
            return (
              <label
                key={column}
                className="flex items-center gap-3 border-t border-border2 px-3 py-2 first:border-t-0"
              >
                <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-[3px]", COLUMN_DOT[column])} />
                <span className="flex-1 text-[13px] font-semibold text-ink">
                  {COLUMN_NAME[column]}
                </span>
                <select
                  value={picked ?? LEAVE}
                  disabled={names.length === 0 && !picked}
                  onChange={(e) =>
                    save({
                      ...map,
                      to: { ...map.to, [column]: e.target.value || null },
                    })
                  }
                  className="min-w-0 max-w-[60%] shrink rounded-[8px] border border-border bg-surface2 px-2.5 py-1.5 text-[12.5px] outline-none focus:border-faint"
                >
                  <option value={LEAVE}>Leave Jira alone</option>
                  {names.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
        <p className="m-0 mt-2.5 text-[12px] text-faint">
          A ticket already in a status that lands in that column is left as it
          is. Only moves you make from now on are sent, at the moment you make
          them, and Jira shows them in the ticket&apos;s history as yours.
        </p>
      </div>
    </div>
  );
}
