"use client";

import Link from "next/link";
import { useTransition } from "react";
import { CalendarPlus, Link2 } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { updateSettingsAction } from "@/lib/actions/settings";

/**
 * Told once, at the only moment it is relevant.
 *
 * Somebody typing their first meeting by hand is somebody who does not know
 * that the meeting probably already exists in Google or Outlook and can be
 * mirrored in. Settings holds the answer, but nobody opens Settings to find
 * out what a product can do — they open it once they know there is something
 * to configure. So the offer goes where the need is: the first press of
 * "Meeting", and never again.
 *
 * Three deliberate limits, because an interruption that misjudges its welcome
 * is worse than no interruption:
 *
 *   - Only with no calendars linked. Somebody who already did this does not
 *     need to be sold it.
 *   - Only once, ever, whichever button they press. Both paths mark it as
 *     offered, including the close button, so it cannot become a thing that
 *     keeps happening until you give in.
 *   - Never a wall. "Not now" carries straight on into the meeting they were
 *     already trying to add, with nothing lost.
 */
export function CalendarLinkOffer({
  open,
  onOpenChange,
  onSkip,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dismissed: carry on to the meeting they actually asked for. */
  onSkip: () => void;
}) {
  const [, start] = useTransition();

  // Fire and forget. If this write fails the worst case is being asked once
  // more on the next first meeting, which is not worth blocking a dialog on.
  const markOffered = () =>
    start(async () => {
      await updateSettingsAction({ calendarLinkOffered: true });
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          markOffered();
          onSkip();
        }
        onOpenChange(o);
      }}
    >
      <DialogContent
        className="max-w-[430px] gap-0 rounded-[13px] p-0"
        style={{ boxShadow: "2px 2px 0 var(--shadow)" }}
      >
        <div className="border-b border-border2 bg-surface2/60 px-5 py-4">
          <DialogHeader className="gap-1">
            <DialogTitle className="flex items-center gap-2 text-base font-extrabold tracking-tight">
              <Link2 className="h-4 w-4 text-primary" />
              Your real calendar can live in here
            </DialogTitle>
            <p className="m-0 text-[13px] leading-relaxed text-muted">
              Google, Outlook, Office 365 and iCloud each publish a private
              link ending in <span className="font-mono text-ink">.ics</span>.
              Paste it once and those meetings appear beside yours.
            </p>
          </DialogHeader>
        </div>
        <div className="flex flex-col gap-2.5 px-5 py-4">
          <p className="m-0 font-mono text-[11px] leading-relaxed text-faint2">
            Read only. PUMMA never writes to them, and nothing you do here is
            visible to anyone else on those calendars.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                markOffered();
                onOpenChange(false);
                onSkip();
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-muted transition-colors hover:border-faint hover:bg-hover hover:text-ink"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              Not now, add a meeting
            </button>
            {/* A link, not a button: it goes to a page, so it should behave
                like a thing that goes to a page — openable in a new tab, and
                showing its destination on hover. The hash lands on the
                calendar panel rather than the top of a long Settings page. */}
            <Link
              href="/settings#calendars"
              onClick={() => {
                markOffered();
                onOpenChange(false);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-ink bg-ink px-3.5 py-2 text-[12.5px] font-bold text-background transition-colors hover:bg-ink/90"
            >
              Set it up
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
