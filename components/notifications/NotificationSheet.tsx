"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Bell, CalendarPlus, CheckSquare, Link2 } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AppNotification } from "@/lib/schemas";
import {
  markNotificationReadAction,
  snoozeNotificationAction,
} from "@/lib/actions/notifications";

const KIND_ICON = {
  meeting: CalendarPlus,
  task: CheckSquare,
  digest: Bell,
} as const;

const KIND_TINT = {
  meeting: "var(--calendar)",
  task: "var(--tasks)",
  digest: "var(--primary)",
} as const;

/**
 * One notification, opened.
 *
 * The reason this exists rather than a link straight to /calendar: arriving
 * from a notification means you were somewhere else entirely — another app, a
 * locked phone — and landing on a page full of everything you own does not
 * answer the question you tapped to ask. This shows the ONE thing, with the
 * button you actually wanted on it.
 *
 * Same component for the tray and for the click-through, so what a banner
 * gives you is what the bell gives you.
 */
export function NotificationSheet({
  notification,
  onClose,
}: {
  notification: AppNotification | null;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  if (!notification) return null;

  const Icon = KIND_ICON[notification.kind] ?? Bell;
  const tint = KIND_TINT[notification.kind] ?? "var(--primary)";

  const snooze = () =>
    start(async () => {
      const res = await snoozeNotificationAction(notification.id);
      if (!res.ok) toast.error(res.error);
      else toast.success("Back in 10 minutes");
      onClose();
    });

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (o) return;
        // Opening it IS reading it. A separate "mark read" would be a chore
        // bolted onto the thing that already told you.
        void markNotificationReadAction(notification.id);
        onClose();
      }}
    >
      <DialogContent
        className="max-w-[420px] gap-0 rounded-[13px] p-0"
        style={{ boxShadow: "2px 2px 0 var(--shadow)" }}
      >
        <div className="border-b border-border2 bg-surface2/60 px-5 py-4">
          <DialogHeader className="gap-1">
            <DialogTitle className="flex items-start gap-2.5 text-base font-extrabold tracking-tight">
              <span
                aria-hidden
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: `color-mix(in oklab, ${tint} 16%, transparent)`,
                  color: tint,
                }}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">{notification.title}</span>
            </DialogTitle>
            <p className="m-0 pl-[34px] text-[13px] leading-relaxed text-muted">
              {notification.body}
            </p>
          </DialogHeader>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-5 py-4">
          {notification.joinUrl && (
            <a
              href={notification.joinUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => void markNotificationReadAction(notification.id)}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90"
              style={{ background: "var(--calendar)" }}
            >
              <Link2 className="h-3.5 w-3.5" />
              Join now
            </a>
          )}
          <Link
            href={notification.url}
            onClick={() => {
              void markNotificationReadAction(notification.id);
              onClose();
            }}
            className="rounded-lg border border-border bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-muted transition-colors hover:border-faint hover:text-ink"
          >
            {notification.kind === "task" ? "Open task" : "Open"}
          </Link>
          <button
            type="button"
            disabled={pending}
            onClick={snooze}
            className="ml-auto rounded-lg px-3 py-2 text-[12px] font-semibold text-faint transition-colors hover:text-ink disabled:opacity-50"
          >
            Snooze 10m
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
