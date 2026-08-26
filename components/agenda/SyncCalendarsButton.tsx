"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { RefreshCw } from "@/components/icons";
import { refreshCalendarFeedsAction } from "@/lib/actions/calendar-feeds";
import { cn } from "@/lib/utils";

/**
 * Pull the subscribed calendars again, now.
 *
 * Feeds refresh on their own, but the publishers cache hard: Google in
 * particular can sit on a change for hours, so "I added it over there, where
 * is it" is the normal question and it deserves an answer that is not "wait".
 *
 * Renders nothing when there are no subscriptions. A refresh button for zero
 * calendars is a button that does nothing, and the place to learn the feature
 * exists is Settings, not a mystery icon in the corner of a widget.
 */
export function SyncCalendarsButton({
  feedCount,
  className,
}: {
  feedCount: number;
  className?: string;
}) {
  const [pending, start] = useTransition();
  if (feedCount === 0) return null;

  return (
    <button
      type="button"
      disabled={pending}
      aria-label="Sync linked calendars"
      title={`Sync ${feedCount} linked calendar${feedCount === 1 ? "" : "s"}`}
      onClick={() =>
        start(async () => {
          const res = await refreshCalendarFeedsAction();
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          const { synced, failed } = res.data ?? { synced: 0, failed: 0 };
          if (failed) toast.warning(`${synced} updated, ${failed} failed`);
          else toast.success(synced ? `${synced} updated` : "Already up to date");
        })
      }
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface text-faint transition-colors hover:border-faint hover:text-ink disabled:opacity-50",
        className,
      )}
    >
      <RefreshCw className={cn("h-3.5 w-3.5", pending && "animate-spin")} />
    </button>
  );
}
