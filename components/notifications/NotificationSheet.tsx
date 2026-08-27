"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Bell,
  CalendarPlus,
  CheckSquare,
  ChevronDown,
  Link2,
  Trash2,
} from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AppNotification } from "@/lib/schemas";
import {
  eventStartFrom,
  relativeToNow,
  SNOOZE_CHOICES,
} from "@/lib/notifications";
import {
  dismissNotificationAction,
  markNotificationReadAction,
  restoreNotificationAction,
  snoozeNotificationAction,
} from "@/lib/actions/notifications";
import { cn } from "@/lib/utils";

const KIND = {
  meeting: { icon: CalendarPlus, tint: "var(--calendar)", noun: "Meeting" },
  task: { icon: CheckSquare, tint: "var(--tasks)", noun: "Task" },
  digest: { icon: Bell, tint: "var(--primary)", noun: "Today" },
} as const;

/** What the main button should say, given what this notification is about. */
function primaryLabel(n: AppNotification): string {
  if (n.kind === "task") return "Open the task";
  if (n.kind === "digest") return "See today's tasks";
  return "Show it in the calendar";
}

/**
 * One notification, opened.
 *
 * Rewritten because the first version was two vague buttons. "Open" did not
 * say where it went and sometimes appeared to do nothing — it navigated to a
 * page you might already be on — and the body read "in 10 min" forever,
 * because that phrase was baked in when the reminder was PLANNED rather than
 * worked out when somebody read it. Both are fixed here: the countdown is
 * live and ticks, and every button names its destination.
 */
export function NotificationSheet({
  notification,
  onClose,
  onChanged,
  loading = false,
}: {
  notification: AppNotification | null;
  onClose: () => void;
  /** Something happened that the tray needs to reload for. */
  onChanged?: () => void;
  /**
   * Show the frame before the notification itself has arrived.
   *
   * Opening a push notification on a phone is a cold start: the app has to
   * download, hydrate, and then ask the server which notifications exist
   * before it can know anything about the one that was tapped. Until all of
   * that finished, this rendered nothing, so tapping a reminder put you on
   * the home page for several seconds with no sign that anything had been
   * understood. The frame costs nothing and says "yes, that tap landed".
   */
  loading?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  // Ticks so "in 3 min" becomes "in 2 min" while the sheet is open, rather
  // than freezing at whatever it said when it was opened.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  if (!notification) return loading ? <SheetSkeleton onClose={onClose} /> : null;
  const n = notification;
  const meta = KIND[n.kind] ?? KIND.digest;
  const Icon = meta.icon;

  const startsAt = eventStartFrom(n.fireAt, n.leadMins);
  const relative = relativeToNow(startsAt, now);
  const past = new Date(startsAt).getTime() < now.getTime();

  const done = (message: string) => {
    toast.success(message);
    onChanged?.();
    onClose();
  };

  const snooze = (minutes: number) =>
    start(async () => {
      const res = await snoozeNotificationAction(n.id, minutes);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      done(
        minutes < 60
          ? `Back in ${minutes} minutes`
          : `Back in ${minutes / 60} hour${minutes === 60 ? "" : "s"}`,
      );
    });

  const dismiss = () =>
    start(async () => {
      const res = await dismissNotificationAction(n.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const was = res.data?.was ?? "read";
      toast.success("Notification removed", {
        action: {
          label: "Undo",
          onClick: () => {
            void restoreNotificationAction(n.id, was).then((r) => {
              if (!r.ok) toast.error(r.error);
              else onChanged?.();
            });
          },
        },
      });
      onChanged?.();
      onClose();
    });

  const go = () => {
    void markNotificationReadAction(n.id);
    router.push(n.url);
    onChanged?.();
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (o) return;
        // Opening it IS reading it.
        void markNotificationReadAction(n.id);
        onChanged?.();
        onClose();
      }}
    >
      <DialogContent
        className="max-w-[430px] gap-0 rounded-[13px] p-0"
        style={{ boxShadow: "2px 2px 0 var(--shadow)" }}
      >
        <div className="border-b border-border2 bg-surface2/60 px-5 py-4">
          <DialogHeader className="gap-2">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                style={{
                  background: `color-mix(in oklab, ${meta.tint} 16%, transparent)`,
                  color: meta.tint,
                }}
              >
                <Icon className="h-3 w-3" />
              </span>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
                {meta.noun}
              </span>
            </div>
            <DialogTitle className="text-base font-extrabold leading-snug tracking-tight">
              {n.title}
            </DialogTitle>
            {/* The clock time is fixed and stored; the relative half is
                computed now and keeps ticking. */}
            <p className="m-0 flex items-baseline gap-2 text-[13px] text-muted">
              <span className="font-mono">{n.body}</span>
              <span
                className={cn(
                  "font-mono text-[11px] font-semibold",
                  past ? "text-faint2" : "text-primary",
                )}
              >
                {past ? `started ${relative}` : relative}
              </span>
            </p>
          </DialogHeader>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          {/* The thing somebody actually opened this for, when there is one. */}
          {n.joinUrl && (
            <a
              href={n.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                void markNotificationReadAction(n.id);
                onChanged?.();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-[13px] font-bold text-white transition-opacity hover:opacity-90"
              style={{ background: meta.tint }}
            >
              <Link2 className="h-4 w-4" />
              Join the call
            </a>
          )}

          {/* Wraps rather than squeezing. Three controls plus a trash icon is
              more than a narrow phone fits on one line, and a button that has
              been crushed to fit is harder to hit than one on its own row. */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={go}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] font-semibold text-muted transition-colors hover:border-faint hover:text-ink"
            >
              {primaryLabel(n)}
            </button>

            {/* Snooze, with a choice. One fixed length was either too short
                or too long for most of what lands here. */}
            <Popover open={snoozeOpen} onOpenChange={setSnoozeOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={pending}
                  className="flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] font-semibold text-muted transition-colors hover:border-faint hover:text-ink disabled:opacity-50"
                >
                  Snooze
                  <ChevronDown className="h-3 w-3" />
                </button>
              </PopoverTrigger>
              {/* Five short durations, laid out as a block of chips rather
                  than a column of rows.
                  
                  As a list it was a tall thin strip that hung well below the
                  dialog and over the page behind it, which read as a menu
                  belonging to nothing. Every row also reserved space for a
                  tick that is never shown, so each one was mostly empty. The
                  durations are two or three characters; letting them sit side
                  by side makes the whole thing about the size of the button
                  that opens it.

                  It opens UPWARD. The button sits on the sheet's bottom row,
                  so downward put the menu over the page behind the dialog,
                  attached to nothing. Upward it lands on the sheet itself,
                  which is what it belongs to. Radix still flips it if there is
                  no room. */}
              <PopoverContent
                side="top"
                align="start"
                collisionPadding={10}
                // Above the dialog, which is z-80. The shared PopoverContent is
                // z-70, fine everywhere else but behind this sheet: opening
                // upward put the menu UNDER the card and it vanished. It only
                // ever looked right pointing down because that landed it past
                // the card's bottom edge, over the page, which is the detached
                // look being fixed here.
                className="z-[90] w-auto p-2"
              >
                <p className="px-0.5 pb-1.5 font-mono text-[10px] uppercase tracking-widest text-faint2">
                  Remind me in
                </p>
                <div className="flex gap-1">
                  {SNOOZE_CHOICES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setSnoozeOpen(false);
                        snooze(m);
                      }}
                      className="rounded-md border border-border bg-surface2 px-2.5 py-1.5 text-center font-mono text-[12px] font-semibold text-muted transition-colors hover:border-primary/40 hover:bg-primary/[0.06] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {m < 60 ? `${m}m` : "1h"}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <button
              type="button"
              disabled={pending}
              onClick={dismiss}
              aria-label="Remove this notification"
              title="Remove"
              className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-faint2 transition-colors hover:border-tasks/40 hover:text-tasks disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The sheet before its notification has loaded.
 *
 * Deliberately the same frame, the same size, and in the same place as the
 * real thing, so it is replaced rather than swapped: nothing moves under the
 * thumb when the content lands. No spinner. This is normally on screen for a
 * moment, and a spinner that flashes for 300ms is noise, while a frame that
 * is already the right shape just looks like the sheet arriving.
 */
function SheetSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-[430px] gap-0 rounded-[13px] p-0"
        style={{ boxShadow: "2px 2px 0 var(--shadow)" }}
      >
        <div className="border-b border-border2 bg-surface2/60 px-5 py-4">
          <DialogHeader className="gap-2">
            <DialogTitle className="sr-only">Opening notification</DialogTitle>
            <div className="flex items-center gap-2">
              <span className="h-5 w-5 shrink-0 animate-pulse rounded-md bg-border" />
              <span className="h-2.5 w-16 animate-pulse rounded bg-border" />
            </div>
            <span className="h-4 w-2/3 animate-pulse rounded bg-border" />
            <span className="h-3 w-2/5 animate-pulse rounded bg-border2" />
          </DialogHeader>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <span className="h-10 w-full animate-pulse rounded-lg bg-border2" />
          <div className="flex gap-2">
            <span className="h-9 w-32 animate-pulse rounded-lg bg-border2" />
            <span className="h-9 w-24 animate-pulse rounded-lg bg-border2" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
