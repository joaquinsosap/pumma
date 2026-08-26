"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useQueryState } from "nuqs";
import { useRouter } from "next/navigation";
import { Bell, Link2, X } from "@/components/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AppNotification } from "@/lib/schemas";
import {
  loadNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/lib/actions/notifications";
import { NotificationSheet } from "@/components/notifications/NotificationSheet";
import { showLocalNotification } from "@/lib/notify-local";
import { cn } from "@/lib/utils";

/** How often the tray refreshes itself while a tab is open. */
const POLL_MS = 60_000;

const KIND_DOT: Record<string, string> = {
  meeting: "var(--calendar)",
  task: "var(--tasks)",
  digest: "var(--primary)",
};

/**
 * The bell, the tray, the pill and the click-through, in one place.
 *
 * They are one component because they are one piece of state: the same list
 * feeds the badge, the tray rows, the "starting soon" pill and whatever the
 * service worker asks to be opened. Splitting them would mean four things
 * fetching the same rows and disagreeing about which are unread.
 *
 * The rule that keeps this from being annoying: exactly ONE thing appears
 * without being asked for — the pill, one at a time, for the newest arrival.
 * Everything else waits behind the bell. There is no toast, no sound, and no
 * permission prompt anywhere near here.
 */
export function NotificationCenter() {
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  // Which notification the sheet is showing, if any. In the URL so a cold
  // start from a push click (`/?n=<id>`) opens the same sheet.
  const [focusId, setFocusId] = useQueryState("n");
  const [pillId, setPillId] = useState<string | null>(null);
  const dismissed = useRef<Set<string>>(new Set());
  const known = useRef<Set<string>>(new Set());
  const first = useRef(true);

  const load = useCallback(async () => {
    const res = await loadNotificationsAction();
    if (!res.ok || !res.data) return;
    const next = res.data.items;

    // Anything unread we have not seen before is new — except on the very
    // first load, where every unread item would qualify and opening the app
    // would announce something from yesterday.
    if (!first.current) {
      const fresh = next.filter(
        (n) =>
          n.status === "sent" &&
          !known.current.has(n.id) &&
          !dismissed.current.has(n.id),
      );
      if (fresh.length) {
        if (document.visibilityState === "visible") {
          // Somebody is looking at the page. The pill is enough, and an OS
          // banner for a thing already on screen is just noise.
          setPillId(fresh[0].id);
        } else {
          // The tab is open but nobody is looking at it — another tab, a
          // minimised window, a different app in front. This is the case an
          // in-app pill cannot serve and push should not have to: the page
          // is still running, so it raises the banner itself.
          for (const n of fresh) void showLocalNotification(n);
        }
      }
    }
    first.current = false;
    for (const n of next) known.current.add(n.id);
    setItems(next);
  }, []);

  useEffect(() => {
    void load();
    // Polls while hidden too, which is the opposite of what the calendar
    // sync does — and deliberately so. A hidden tab finding a stale calendar
    // is work nobody can see, but a hidden tab finding a due reminder is
    // exactly when the OS banner is the only thing that can reach somebody.
    // Browsers throttle background timers to about once a minute, which is
    // this interval anyway, so the cost of leaving it running is a request a
    // minute from a tab that is already open.
    const timer = window.setInterval(() => void load(), POLL_MS);
    // Coming back to the tab is worth an immediate check rather than waiting
    // out the rest of the interval.
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // The service worker's plain-click path: it focuses this tab and says which
  // notification it was, so the sheet opens on whatever page happens to be up.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "pumma-notification" || !e.data.id) return;
      void setFocusId(String(e.data.id));
      void load();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [load, setFocusId]);

  const unread = items.filter((n) => n.status === "sent").length;
  const focused = useMemo(
    () => items.find((n) => n.id === focusId) ?? null,
    [items, focusId],
  );
  const pill = useMemo(
    () => (pillId ? (items.find((n) => n.id === pillId) ?? null) : null),
    [items, pillId],
  );

  const openOne = (n: AppNotification) => {
    setOpen(false);
    setPillId(null);
    void setFocusId(n.id);
  };

  const closeSheet = () => {
    void setFocusId(null);
    startTransition(() => {
      void load();
      router.refresh();
    });
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
            className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface2 text-faint transition-colors hover:border-faint hover:text-ink"
          >
            <Bell className="h-3.5 w-3.5" />
            {unread > 0 && (
              <span
                className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[9px] font-bold text-white"
                style={{ background: "var(--tasks)" }}
              >
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          collisionPadding={12}
          className="max-h-[min(70vh,460px)] w-[300px] max-w-[calc(100vw-24px)] overflow-y-auto p-0"
        >
          <div className="flex items-center justify-between border-b border-border2 px-3 py-2">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
              Notifications
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    await markAllNotificationsReadAction();
                    void load();
                  })
                }
                className="text-[11px] font-semibold text-faint transition-colors hover:text-ink"
              >
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="m-0 px-3 py-4 text-[12px] leading-relaxed text-faint">
              Nothing yet. Reminders for meetings and timed tasks land here.
            </p>
          ) : (
            <div className="flex flex-col p-1.5">
              {items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openOne(n)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-hover",
                    n.status === "sent" ? "text-ink" : "text-muted",
                  )}
                >
                  <span
                    aria-hidden
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: KIND_DOT[n.kind] ?? "var(--faint2)",
                      // Read ones keep the dot, drained. The colour is what
                      // says "meeting" or "task" at a glance; losing it
                      // entirely would make the read half of the tray
                      // unreadable in a different sense.
                      opacity: n.status === "sent" ? 1 : 0.35,
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-[12.5px]",
                        n.status === "sent" && "font-semibold",
                      )}
                    >
                      {n.title}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-faint2">
                      {n.body}
                    </span>
                  </span>
                  {n.joinUrl && (
                    <Link2 className="mt-1 h-3 w-3 shrink-0 text-faint2" />
                  )}
                </button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* The only thing that appears uninvited. One at a time, newest wins,
          and dismissing it puts it back behind the bell rather than
          destroying it. */}
      {pill && !focused && (
        <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[190] flex justify-center px-3 sm:bottom-6 sm:left-auto sm:right-6 sm:justify-end sm:px-0">
          <div className="pumma-floating pointer-events-auto flex max-w-[min(100%,380px)] animate-pumma-rise items-center gap-2.5 rounded-xl border border-border px-3 py-2 shadow-[0_6px_20px_var(--shadow)]">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: KIND_DOT[pill.kind] ?? "var(--primary)" }}
            />
            <button
              type="button"
              onClick={() => openOne(pill)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block truncate text-[12.5px] font-semibold text-ink">
                {pill.title}
              </span>
              <span className="block truncate font-mono text-[10px] text-faint">
                {pill.body}
              </span>
            </button>
            {pill.joinUrl && (
              <a
                href={pill.joinUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => void markNotificationReadAction(pill.id)}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold text-white"
                style={{ background: "var(--calendar)" }}
              >
                Join
              </a>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                dismissed.current.add(pill.id);
                setPillId(null);
              }}
              className="shrink-0 text-faint2 transition-colors hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <NotificationSheet notification={focused} onClose={closeSheet} />
    </>
  );
}
