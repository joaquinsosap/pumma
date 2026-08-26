"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Link2, Plus, RefreshCw, Trash2 } from "@/components/icons";
import type { CalendarFeed } from "@/lib/schemas";
import {
  addCalendarFeedAction,
  refreshCalendarFeedsAction,
  removeCalendarFeedAction,
  renameCalendarFeedAction,
  setCalendarFeedEnabledAction,
} from "@/lib/actions/calendar-feeds";
import { cn } from "@/lib/utils";

/**
 * Where a subscription is added, and the only place one can be removed.
 *
 * The rows themselves deliberately cannot: an imported event is a reflection
 * of something owned in another calendar, so the only honest "delete" is to
 * stop reading that calendar, and that decision belongs here rather than
 * behind a tap on a Tuesday.
 */

/** Said once, where somebody is standing when they need it. */
const WHERE_TO_FIND_IT: { app: string; steps: string }[] = [
  {
    app: "Google Calendar",
    steps:
      "Settings, pick the calendar, then Integrate calendar. Use the Secret address in iCal format.",
  },
  {
    app: "Outlook and Office 365",
    steps:
      "Settings, Calendar, Shared calendars. Publish the calendar, choose Can view all details, and copy the ICS link.",
  },
  {
    app: "Apple iCloud",
    steps:
      "In Calendar on the Mac, right-click the calendar, Share Calendar, tick Public Calendar, then copy the link.",
  },
];

function relative(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function CalendarFeeds({ feeds }: { feeds: CalendarFeed[] }) {
  const [url, setUrl] = useState("");
  const [area, setArea] = useState<"personal" | "work">("personal");
  const [pending, start] = useTransition();
  const [help, setHelp] = useState(false);

  const add = () => {
    if (!url.trim()) return;
    start(async () => {
      const res = await addCalendarFeedAction(url.trim(), area);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setUrl("");
      toast.success(`Reading ${res.data?.label ?? "that calendar"}`);
    });
  };

  const refresh = () => {
    start(async () => {
      const res = await refreshCalendarFeedsAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const { synced, failed } = res.data ?? { synced: 0, failed: 0 };
      toast[failed ? "warning" : "success"](
        failed ? `${synced} updated, ${failed} failed` : `${synced} updated`,
      );
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="Paste a calendar link ending in .ics"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[12px] text-ink outline-none placeholder:text-faint2 focus:border-faint"
        />
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface2 p-1">
          {(["personal", "work"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setArea(a)}
              className={cn(
                "rounded-md px-2.5 py-1 font-mono text-[11px] font-semibold capitalize transition-colors",
                area === a ? "bg-surface text-ink" : "text-faint",
              )}
            >
              {a}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={add}
          disabled={pending || !url.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-[12.5px] font-bold text-background transition-opacity disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={3} />
          Add
        </button>
      </div>

      <button
        type="button"
        onClick={() => setHelp((v) => !v)}
        className="self-start font-mono text-[11px] text-faint underline-offset-2 hover:text-ink hover:underline"
      >
        {help ? "Hide" : "Where do I find that link?"}
      </button>
      {help && (
        <ul className="m-0 flex list-none flex-col gap-2 rounded-lg border border-border bg-surface2 p-3">
          {WHERE_TO_FIND_IT.map((h) => (
            <li key={h.app}>
              <p className="m-0 text-[12.5px] font-bold text-ink">{h.app}</p>
              <p className="m-0 mt-0.5 text-[12px] leading-relaxed text-muted">
                {h.steps}
              </p>
            </li>
          ))}
          <li className="border-t border-border2 pt-2">
            <p className="m-0 text-[12px] leading-relaxed text-faint">
              PUMMA only reads. It never writes to these calendars, and nothing
              you do here is visible to anyone else on them. Treat the link
              like a password: anyone who has it can read that calendar.
            </p>
          </li>
        </ul>
      )}

      {feeds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {feeds.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5"
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                style={{ background: f.color }}
              />
              <div className="min-w-0 flex-1">
                {/* Editable in place. Google names a feed after the account,
                    Outlook names every one of them "Calendar", so two work
                    subscriptions arrive indistinguishable and the only fix is
                    letting you say which is which. */}
                <p className="m-0 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                  <Link2 className="h-3 w-3 shrink-0 text-faint2" />
                  <input
                    defaultValue={f.label}
                    aria-label={`Name for ${f.label}`}
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      if (!next || next === f.label) {
                        e.target.value = f.label;
                        return;
                      }
                      start(async () => {
                        const res = await renameCalendarFeedAction(f.id, next);
                        if (!res.ok) {
                          toast.error(res.error);
                          e.target.value = f.label;
                        }
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") {
                        e.currentTarget.value = f.label;
                        e.currentTarget.blur();
                      }
                    }}
                    className="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-semibold text-ink outline-none transition-colors hover:border-border focus:border-faint focus:bg-surface2"
                  />
                </p>
                <p className="m-0 mt-0.5 font-mono text-[10.5px] text-faint2">
                  {f.lifeArea} · synced {relative(f.lastSyncedAt)}
                  {f.lastError ? ` · ${f.lastError}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  start(async () => {
                    await setCalendarFeedEnabledAction(f.id, !f.enabled);
                  })
                }
                className={cn(
                  "shrink-0 rounded-md border px-2 py-1 font-mono text-[10.5px] font-semibold transition-colors",
                  f.enabled
                    ? "border-border bg-surface2 text-muted"
                    : "border-dashed border-faint2 text-faint2",
                )}
              >
                {f.enabled ? "on" : "off"}
              </button>
              <button
                type="button"
                aria-label={`Stop reading ${f.label}`}
                onClick={() =>
                  start(async () => {
                    const res = await removeCalendarFeedAction(f.id);
                    if (!res.ok) toast.error(res.error);
                    else toast.success(`Stopped reading ${f.label}`);
                  })
                }
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint2 transition-colors hover:bg-tasks/10 hover:text-tasks"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            className="mt-1 flex items-center gap-1.5 self-start rounded-lg border border-border bg-surface2 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-muted transition-colors hover:border-faint hover:text-ink disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", pending && "animate-spin")} />
            Refresh now
          </button>
        </div>
      )}

      {feeds.length === 0 && (
        <p className="m-0 text-[12.5px] leading-relaxed text-faint">
          Subscribe to a calendar and its events appear alongside your own
          meetings, marked with a chain. Reading only, so nothing here can
          change what is on the other side.
        </p>
      )}
    </div>
  );
}
