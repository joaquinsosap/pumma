"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Repeat, Trash2 } from "@/components/icons";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addMeetingAction,
  updateMeetingAction,
  deleteMeetingAction,
} from "@/lib/actions/agenda";
import { describeRecurrence, weekdayOf } from "@/lib/meetings";
import type { AgendaItem, Recurrence } from "@/lib/schemas";
import { lifeAreaForCreate, type LifeView } from "@/lib/life-area";
import { cn } from "@/lib/utils";

const DURATIONS = [15, 30, 45, 60, 90, 120] as const;
const FREQS = [
  { key: "none", label: "Once" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
] as const;
type FreqKey = (typeof FREQS)[number]["key"];
// Monday-first for the picker; values stay JS getDay() (0=Sun).
const WEEKDAYS = [
  { v: 1, l: "M" },
  { v: 2, l: "T" },
  { v: 3, l: "W" },
  { v: 4, l: "T" },
  { v: 5, l: "F" },
  { v: 6, l: "S" },
  { v: 0, l: "S" },
] as const;
type EndMode = "never" | "on" | "after";

const fieldClass =
  "w-full rounded-lg border border-border bg-background px-2.5 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-faint2 focus:border-faint";
const labelClass =
  "mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2";

/**
 * Create/edit a meeting, including its repeat rule. Deliberately the same form
 * in both modes so "every other Tuesday until December" is as easy to fix as
 * it is to set up.
 */
export function MeetingDialog({
  open,
  onOpenChange,
  defaultDate,
  lifeView,
  meeting,
  occurrenceDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDate: string;
  lifeView: LifeView;
  /** Provided = edit mode. */
  meeting?: AgendaItem | null;
  /** Which instance was clicked (drives "delete just this one"). */
  occurrenceDate?: string;
}) {
  const editing = Boolean(meeting);
  const [pending, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState<number>(30);
  const [notes, setNotes] = useState("");
  const [freq, setFreq] = useState<FreqKey>("none");
  const [interval, setInterval] = useState(1);
  const [byWeekday, setByWeekday] = useState<number[]>([]);
  const [endMode, setEndMode] = useState<EndMode>("never");
  const [until, setUntil] = useState("");
  const [count, setCount] = useState(10);

  // Reset the form each time it opens so a previous edit never leaks through.
  useEffect(() => {
    if (!open) return;
    if (meeting) {
      setTitle(meeting.title);
      setDate(meeting.date ?? defaultDate);
      setTime(meeting.time);
      setDuration(meeting.durationMins);
      setNotes(meeting.notes);
      const r = meeting.recurrence;
      setFreq(r ? r.freq : "none");
      setInterval(r?.interval ?? 1);
      setByWeekday(r?.byWeekday ?? []);
      setEndMode(r?.until ? "on" : r?.count != null ? "after" : "never");
      setUntil(r?.until ?? "");
      setCount(r?.count ?? 10);
    } else {
      setTitle("");
      setDate(defaultDate);
      setTime("10:00");
      setDuration(30);
      setNotes("");
      setFreq("none");
      setInterval(1);
      setByWeekday([]);
      setEndMode("never");
      setUntil("");
      setCount(10);
    }
  }, [open, meeting, defaultDate]);

  // Default the weekly picker to the start date's own weekday.
  useEffect(() => {
    if (freq === "weekly" && byWeekday.length === 0 && date) {
      setByWeekday([weekdayOf(date)]);
    }
  }, [freq, date, byWeekday.length]);

  const recurrence: Recurrence | null = useMemo(() => {
    if (freq === "none") return null;
    return {
      freq,
      interval: Math.max(1, interval),
      byWeekday: freq === "weekly" ? byWeekday : [],
      until: endMode === "on" && until ? until : null,
      count: endMode === "after" ? Math.max(1, count) : null,
    };
  }, [freq, interval, byWeekday, endMode, until, count]);

  const summary = describeRecurrence(recurrence, date);
  const canSave =
    title.trim().length > 0 &&
    Boolean(date) &&
    !(freq === "weekly" && byWeekday.length === 0) &&
    !(endMode === "on" && !until);

  const submit = () => {
    if (!canSave) return;
    startTransition(async () => {
      const payload = {
        title: title.trim(),
        date,
        time,
        durationMins: duration,
        lifeArea: lifeAreaForCreate(lifeView),
        notes: notes.trim(),
        recurrence,
      };
      const res = meeting
        ? await updateMeetingAction({ id: meeting.id, ...payload })
        : await addMeetingAction(payload);
      if (!res.ok) {
        toast.error(res.error ?? "Could not save the meeting");
        return;
      }
      toast.success(editing ? "Meeting updated" : "Meeting added");
      onOpenChange(false);
    });
  };

  const remove = (scope: "occurrence" | "series") => {
    if (!meeting) return;
    startTransition(async () => {
      const res = await deleteMeetingAction({
        id: meeting.id,
        scope,
        date: occurrenceDate ?? meeting.date ?? undefined,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not remove the meeting");
        return;
      }
      toast.success(scope === "series" ? "Meeting deleted" : "Occurrence removed");
      onOpenChange(false);
    });
  };

  const repeats = freq !== "none";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] w-[min(94vw,26rem)] gap-0 overflow-y-auto p-0">
        <DialogHeader className="border-b border-border2 bg-surface2/60 px-5 py-3.5">
          <DialogTitle className="text-base font-extrabold tracking-tight">
            {editing ? "Edit meeting" : "New meeting"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3.5 px-5 py-4">
          <div>
            <label htmlFor="m-title" className={labelClass}>
              Title
            </label>
            <input
              id="m-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Standup, 1:1, dentist…"
              maxLength={200}
              disabled={pending}
              className={fieldClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label htmlFor="m-date" className={labelClass}>
                {repeats ? "Starts" : "Date"}
              </label>
              <input
                id="m-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={pending}
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="m-time" className={labelClass}>
                Time
              </label>
              <input
                id="m-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={pending}
                className={fieldClass}
              />
            </div>
          </div>

          <div>
            <span className={labelClass}>Duration</span>
            <div className="flex flex-wrap gap-1.5">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  disabled={pending}
                  className={cn(
                    "rounded-lg border-2 px-2.5 py-1 font-mono text-[11px] font-semibold transition-all active:scale-95",
                    duration === d
                      ? "border-primary bg-primary/12 text-primary"
                      : "border-border bg-surface text-muted hover:border-faint"
                  )}
                >
                  {d >= 60 ? `${d / 60}h${d % 60 ? ` ${d % 60}m` : ""}` : `${d}m`}
                </button>
              ))}
            </div>
          </div>

          {/* ---- Repeat ---- */}
          <div className="rounded-xl border border-border bg-surface2/40 p-3">
            <span className={cn(labelClass, "flex items-center gap-1.5")}>
              <Repeat className="h-3 w-3" />
              Repeat
            </span>
            <div className="grid grid-cols-4 gap-1.5">
              {FREQS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFreq(f.key)}
                  disabled={pending}
                  className={cn(
                    "rounded-lg border-2 py-1.5 text-[11px] font-semibold transition-all active:scale-95",
                    freq === f.key
                      ? "border-primary bg-primary/12 text-primary"
                      : "border-border bg-surface text-muted hover:border-faint"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {repeats && (
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-[12px] text-muted">Every</span>
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={interval}
                    onChange={(e) =>
                      setInterval(Math.max(1, Number(e.target.value) || 1))
                    }
                    disabled={pending}
                    aria-label="Repeat interval"
                    className="w-14 rounded-lg border border-border bg-background px-2 py-1 text-center font-mono text-[12px] text-ink outline-none focus:border-faint"
                  />
                  <span className="text-[12px] text-muted">
                    {freq === "daily"
                      ? interval === 1
                        ? "day"
                        : "days"
                      : freq === "weekly"
                        ? interval === 1
                          ? "week"
                          : "weeks"
                        : interval === 1
                          ? "month"
                          : "months"}
                  </span>
                </div>

                {freq === "weekly" && (
                  <div>
                    <span className={labelClass}>On</span>
                    <div className="flex gap-1">
                      {WEEKDAYS.map((d, i) => {
                        const on = byWeekday.includes(d.v);
                        return (
                          <button
                            key={`${d.v}-${i}`}
                            type="button"
                            onClick={() =>
                              setByWeekday((prev) =>
                                prev.includes(d.v)
                                  ? prev.filter((x) => x !== d.v)
                                  : [...prev, d.v]
                              )
                            }
                            disabled={pending}
                            aria-pressed={on}
                            className={cn(
                              "h-8 flex-1 rounded-lg border-2 text-[11px] font-bold transition-all active:scale-95",
                              on
                                ? "border-primary bg-primary/12 text-primary"
                                : "border-border bg-surface text-muted hover:border-faint"
                            )}
                          >
                            {d.l}
                          </button>
                        );
                      })}
                    </div>
                    {byWeekday.length === 0 && (
                      <p className="mt-1.5 text-[11px] text-tasks">
                        Pick at least one day.
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <span className={labelClass}>Ends</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        ["never", "Never"],
                        ["on", "On date"],
                        ["after", "After"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setEndMode(key)}
                        disabled={pending}
                        className={cn(
                          "rounded-lg border-2 py-1.5 text-[11px] font-semibold transition-all active:scale-95",
                          endMode === key
                            ? "border-primary bg-primary/12 text-primary"
                            : "border-border bg-surface text-muted hover:border-faint"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {endMode === "on" && (
                    <input
                      type="date"
                      value={until}
                      min={date}
                      onChange={(e) => setUntil(e.target.value)}
                      disabled={pending}
                      aria-label="Repeat until"
                      className={cn(fieldClass, "mt-2")}
                    />
                  )}
                  {endMode === "after" && (
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={730}
                        value={count}
                        onChange={(e) =>
                          setCount(Math.max(1, Number(e.target.value) || 1))
                        }
                        disabled={pending}
                        aria-label="Number of occurrences"
                        className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-center font-mono text-[12px] text-ink outline-none focus:border-faint"
                      />
                      <span className="text-[12px] text-muted">occurrences</span>
                    </div>
                  )}
                </div>

                <p className="rounded-lg bg-surface px-2.5 py-1.5 font-mono text-[10.5px] text-muted">
                  {summary}
                </p>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="m-notes" className={labelClass}>
              Notes / location
            </label>
            <textarea
              id="m-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Meet link, room, agenda…"
              maxLength={1000}
              rows={2}
              disabled={pending}
              className={cn(fieldClass, "resize-none")}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border2 bg-surface2/40 px-5 py-3.5">
          {editing && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => remove(meeting?.recurrence ? "occurrence" : "series")}
                disabled={pending}
                title={
                  meeting?.recurrence
                    ? "Remove just this occurrence"
                    : "Delete meeting"
                }
                className="flex items-center gap-1 rounded-lg border border-tasks/30 bg-tasks/[0.06] px-2.5 py-2 text-[12px] font-semibold text-tasks transition-colors hover:bg-tasks/10 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {meeting?.recurrence ? "This one" : "Delete"}
              </button>
              {meeting?.recurrence && (
                <button
                  type="button"
                  onClick={() => remove("series")}
                  disabled={pending}
                  title="Delete the whole series"
                  className="rounded-lg border border-border px-2.5 py-2 text-[12px] font-semibold text-muted transition-colors hover:border-tasks/40 hover:text-tasks disabled:opacity-50"
                >
                  All
                </button>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="ml-auto rounded-lg border border-border bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-muted transition-colors hover:border-faint hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !canSave}
            className="rounded-lg bg-ink px-3.5 py-2 text-[12.5px] font-bold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Saving…" : editing ? "Save" : "Add meeting"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
