"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LifeWeek, LifeMood } from "@/lib/schemas";
import type { LifeWeekSlot } from "@/lib/life-calendar";
import { saveLifeWeek } from "@/lib/actions/life-calendar";
import { ageAt } from "@/lib/date";
import {
  LIFE_MOODS,
  formatWeekRange,
  moodColor,
  weekStatusLabel,
} from "@/lib/life-calendar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Props = {
  week: LifeWeekSlot | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  birthDate: string | null;
  lifeWeek: LifeWeek | null;
  today: string;
};

export function LifeWeekDialog({
  week,
  open,
  onOpenChange,
  birthDate,
  lifeWeek,
  today,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [weekMood, setWeekMood] = useState<LifeMood | "">("");
  const [weekNote, setWeekNote] = useState("");

  useEffect(() => {
    if (!open || !week) return;
    setWeekMood(lifeWeek?.mood ?? "");
    setWeekNote(lifeWeek?.note ?? "");
  }, [open, week, lifeWeek]);

  const clear = () => {
    if (!week) return;
    startTransition(async () => {
      const res = await saveLifeWeek({
        weekStart: week.weekStart,
        note: "",
        mood: null,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not clear week");
        return;
      }
      toast.success("Week cleared");
      onOpenChange(false);
      router.refresh();
    });
  };

  const save = () => {
    if (!week) return;
    startTransition(async () => {
      const note = weekNote.trim();
      const mood = weekMood === "" ? null : weekMood;
      if (!note && !mood) {
        const res = await saveLifeWeek({
          weekStart: week.weekStart,
          note: "",
          mood: null,
        });
        if (!res.ok) {
          toast.error(res.error ?? "Could not save week");
          return;
        }
      } else {
        const res = await saveLifeWeek({
          weekStart: week.weekStart,
          note,
          mood,
        });
        if (!res.ok) {
          toast.error(res.error ?? "Could not save week");
          return;
        }
      }
      toast.success("Week saved");
      onOpenChange(false);
      router.refresh();
    });
  };

  if (!week) return null;

  const ageLabel = birthDate != null ? ageAt(birthDate, week.weekStart) : null;
  const rangeLabel = formatWeekRange(week.weekStart, week.weekEnd);
  const status = weekStatusLabel(week.weekStart, week.weekEnd, today);
  const moodC = weekMood ? moodColor(weekMood) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] gap-0 rounded-2xl p-6">
        <div className="mb-4 flex items-start gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] font-mono text-[13px] font-semibold",
              moodC
                ? "text-white"
                : "border border-border bg-surface2 text-muted",
            )}
            style={moodC ? { background: moodC } : undefined}
          >
            {ageLabel ?? "·"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-extrabold tracking-tight text-ink">
              Age {ageLabel ?? "—"} · Week {week.weekIndex.toLocaleString()}
            </div>
            <div className="mt-0.5 font-mono text-[11px] text-faint">
              {rangeLabel} · {status}
            </div>
          </div>
        </div>

        <div className="mb-2 font-mono text-[10px] tracking-widest text-faint2">
          HOW WAS THIS WEEK?
        </div>
        <div className="mb-4 flex gap-1.5">
          {LIFE_MOODS.map((m) => {
            const on = weekMood === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() =>
                  setWeekMood((prev) => (prev === m.value ? "" : m.value))
                }
                className={cn(
                  "flex-1 cursor-pointer rounded-[10px] border px-1 py-2 text-center transition-colors",
                  on
                    ? "border-[1.5px] font-semibold text-ink"
                    : "border-border bg-surface2 text-muted",
                )}
                style={
                  on
                    ? {
                        background: m.color.replace(")", " / 0.14)"),
                        borderColor: m.color,
                      }
                    : undefined
                }
              >
                <div
                  className="mx-auto mb-1.5 h-4 w-4 rounded-[5px]"
                  style={{ background: m.color }}
                />
                <div className="font-mono text-[10px] capitalize">
                  {m.label}
                </div>
              </button>
            );
          })}
        </div>

        <div className="mb-2 font-mono text-[10px] tracking-widest text-faint2">
          MEMORY / NOTE
        </div>
        <textarea
          value={weekNote}
          onChange={(e) => setWeekNote(e.target.value)}
          placeholder="What happened this week? A milestone, a feeling, a moment to remember…"
          rows={4}
          className="mb-4 w-full resize-none rounded-[10px] border border-border bg-surface2 px-3 py-3 text-sm leading-relaxed text-ink outline-none focus:border-faint2"
        />

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={pending}
            onClick={clear}
            className="rounded-[9px] border border-border bg-transparent px-3.5 py-2 text-[13px] font-semibold text-muted disabled:opacity-50"
          >
            Clear
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            className="ml-auto rounded-[9px] border border-border bg-transparent px-3.5 py-2 text-[13px] font-semibold text-muted disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="rounded-[9px] bg-ink px-5 py-2.5 text-[13px] font-bold text-background disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
