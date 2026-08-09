"use client";

import { useState } from "react";
import { CalendarPlus } from "@/components/icons";
import { MeetingDialog } from "@/components/agenda/MeetingDialog";
import type { LifeView } from "@/lib/life-area";
import { cn } from "@/lib/utils";

/**
 * "+ Meeting" trigger — shared by the Agenda widget and the Calendar page so a
 * meeting can be added from anywhere a day is visible. The heavy lifting (dates,
 * duration, repeat rules) lives in MeetingDialog.
 */
export function AddMeetingButton({
  defaultDate,
  lifeView,
  className,
}: {
  defaultDate: string;
  lifeView: LifeView;
  className?: string;
  /** Accepted for call-site compatibility; the dialog is centered. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 font-mono text-[11px] font-semibold text-muted transition-colors hover:border-faint2 hover:text-ink",
          className
        )}
      >
        <CalendarPlus className="h-3.5 w-3.5" />
        Meeting
      </button>
      <MeetingDialog
        open={open}
        onOpenChange={setOpen}
        defaultDate={defaultDate}
        lifeView={lifeView}
      />
    </>
  );
}
