"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LifeDay, LifeMood, Task } from "@/lib/schemas";
import { saveLifeDay } from "@/lib/actions/life-calendar";
import { formatDay } from "@/lib/date";
import { LIFE_MOODS } from "@/lib/life-calendar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Props = {
  date: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lifeDay: LifeDay | null;
  tasks: Task[];
};

export function LifeDayDialog({
  date,
  open,
  onOpenChange,
  lifeDay,
  tasks,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [mood, setMood] = useState<LifeMood | "">("");

  useEffect(() => {
    if (!open || !date) return;
    setNote(lifeDay?.note ?? "");
    setMood(lifeDay?.mood ?? "");
  }, [open, date, lifeDay]);

  const save = () => {
    if (!date) return;
    startTransition(async () => {
      const res = await saveLifeDay({
        date,
        note,
        mood: mood === "" ? null : mood,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not save");
        return;
      }
      toast.success("Day saved");
      onOpenChange(false);
      router.refresh();
    });
  };

  if (!date) return null;

  const label = formatDay(date);
  const dayTasks = tasks.filter((t) => (t.due ?? "").slice(0, 10) === date);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <p className="font-mono text-[11px] text-faint">{date}</p>
        </DialogHeader>

        {dayTasks.length > 0 && (
          <div className="rounded-lg border border-border bg-surface2/60 px-3 py-2.5">
            <div className="mb-2 font-mono text-[9px] font-medium uppercase tracking-widest text-faint2">
              Tasks
            </div>
            <ul className="m-0 flex flex-col gap-1.5 p-0">
              {dayTasks.map((t) => (
                <li
                  key={t.id}
                  className={cn(
                    "list-none text-[13px]",
                    t.status === "done" && "text-faint line-through",
                  )}
                >
                  {t.title}
                </li>
              ))}
            </ul>
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-faint2">
            Mood
          </span>
          <select
            value={mood}
            onChange={(e) => setMood(e.target.value as LifeMood | "")}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="">—</option>
            {LIFE_MOODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-faint2">
            Journal
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Something to remember about this day…"
            rows={4}
            className="resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-faint"
          />
        </label>

        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="w-full rounded-lg bg-ink py-2.5 text-sm font-bold text-background disabled:opacity-50"
        >
          Save day
        </button>
      </DialogContent>
    </Dialog>
  );
}
