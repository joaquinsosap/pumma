"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/schemas";
import { setTaskTimeSpent } from "@/lib/actions/task-timer";
import {
  formatDuration,
  parseDurationInput,
  secondsFromParts,
  taskElapsedSec,
} from "@/lib/time";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type Props = {
  task: Pick<Task, "id" | "title" | "timeSpentSec" | "timerStartedAt">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  now: number;
};

export function TaskTimeEditDialog({ task, open, onOpenChange, now }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const elapsed = taskElapsedSec(task, now);
  const [hours, setHours] = useState(Math.floor(elapsed / 3600));
  const [minutes, setMinutes] = useState(Math.floor((elapsed % 3600) / 60));
  const [textInput, setTextInput] = useState("");

  useEffect(() => {
    if (!open) return;
    setHours(Math.floor(elapsed / 3600));
    setMinutes(Math.floor((elapsed % 3600) / 60));
    setTextInput("");
  }, [open, elapsed]);

  const save = (seconds: number) => {
    startTransition(async () => {
      const res = await setTaskTimeSpent({
        taskId: task.id,
        timeSpentSec: seconds,
      });
      if (!res.ok) {
        toast.error(res.error ?? "Could not save time");
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  };

  const handleSave = () => {
    if (textInput.trim()) {
      const parsed = parseDurationInput(textInput);
      if (parsed === null) {
        toast.error('Use formats like "1h 30m", "45m", or "1:30:00"');
        return;
      }
      save(parsed);
      return;
    }
    save(secondsFromParts(hours, minutes));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Time on task</DialogTitle>
          <p className="text-sm text-muted">{task.title}</p>
        </DialogHeader>
        <p className="font-mono text-[11px] text-faint">
          Current total: {formatDuration(elapsed)}
          {task.timerStartedAt ? " (timer will stop on save)" : ""}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wide text-faint2">
              Hours
            </span>
            <Input
              type="number"
              min={0}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value) || 0)}
              className="font-mono"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wide text-faint2">
              Minutes
            </span>
            <Input
              type="number"
              min={0}
              max={59}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value) || 0)}
              className="font-mono"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wide text-faint2">
            Or type duration
          </span>
          <Input
            placeholder='e.g. "1h 30m" or "45m"'
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            className="font-mono text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSave();
              }
            }}
          />
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={handleSave}
          className="mt-1 w-full rounded-lg bg-ink py-2 text-sm font-bold text-background disabled:opacity-50"
        >
          Save time
        </button>
      </DialogContent>
    </Dialog>
  );
}
