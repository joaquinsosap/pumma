"use client";

import { useState } from "react";
import { CalendarPlus } from "@/components/icons";
import { MeetingDialog } from "@/components/agenda/MeetingDialog";
import { CalendarLinkOffer } from "@/components/agenda/CalendarLinkOffer";
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
  feedCount = 0,
  linkOffered = true,
  className,
}: {
  defaultDate: string;
  lifeView: LifeView;
  /** Calendars already mirrored in. Anything above zero, and they know. */
  feedCount?: number;
  /**
   * Has the one-time offer already been made? Defaults to true so a call site
   * that has not been taught about it stays silent rather than nagging.
   */
  linkOffered?: boolean;
  className?: string;
  /** Accepted for call-site compatibility; the dialog is centered. */
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [offering, setOffering] = useState(false);
  // Latched at the first press. Without it, the settings write lands, the page
  // revalidates, `linkOffered` flips underneath an open dialog and the offer
  // vanishes mid-read.
  const [offerDone, setOfferDone] = useState(false);
  const shouldOffer = feedCount === 0 && !linkOffered && !offerDone;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (shouldOffer) {
            setOfferDone(true);
            setOffering(true);
            return;
          }
          setOpen(true);
        }}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 font-mono text-[11px] font-semibold text-muted transition-colors hover:border-faint2 hover:text-ink",
          className,
        )}
      >
        <CalendarPlus className="h-3.5 w-3.5" />
        Meeting
      </button>
      <CalendarLinkOffer
        open={offering}
        onOpenChange={setOffering}
        onSkip={() => setOpen(true)}
      />
      <MeetingDialog
        open={open}
        onOpenChange={setOpen}
        defaultDate={defaultDate}
        lifeView={lifeView}
      />
    </>
  );
}
