"use client";

import { useEffect, useRef } from "react";
import { syncStaleCalendarsAction } from "@/lib/actions/calendar-feeds";

/**
 * Keeps subscribed calendars fresh while somebody is actually here.
 *
 * Renders nothing. It exists because the alternative is a cron that fetches
 * every feed for every account around the clock, including the accounts
 * nobody has opened in a month. Tying the work to attention makes the cost
 * scale with use rather than with the size of the user table, and the person
 * who benefits from a fetch is by definition the one looking at the screen.
 *
 * Three rules, and each is load-bearing:
 *
 *   - Never while hidden. A background tab left open for a week must not
 *     poll for a week; `visibilitychange` starts and stops the timer.
 *   - Never twice at once. A slow fetch plus a fast interval is how you get
 *     four overlapping syncs of the same feed.
 *   - Never more often than the server would act on anyway. The client
 *     throttle mirrors the server's staleness window, so a burst of mounts
 *     across tabs does not turn into a burst of requests.
 */

/** Matches STALE_AFTER_MS. A tighter interval would only be refused server-side. */
const POLL_MS = 5 * 60 * 1000;
/** Module-level, so several mounts in one tab share one clock. */
let lastAttempt = 0;

export function CalendarAutoSync({ feedCount }: { feedCount: number }) {
  const running = useRef(false);

  useEffect(() => {
    if (feedCount === 0) return;

    const attempt = async () => {
      if (document.visibilityState !== "visible") return;
      if (running.current) return;
      if (Date.now() - lastAttempt < POLL_MS) return;
      running.current = true;
      lastAttempt = Date.now();
      try {
        await syncStaleCalendarsAction();
      } catch {
        // A failed refresh is not worth a toast. The feed row in Settings
        // carries its own last error, which is where somebody goes to find
        // out why a calendar is not updating.
      } finally {
        running.current = false;
      }
    };

    // On arrival, and whenever the tab comes back — that second one is the
    // case that matters, because "I left this open overnight" is exactly when
    // the data is most stale.
    void attempt();
    const onVisible = () => void attempt();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = window.setInterval(() => void attempt(), POLL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(timer);
    };
  }, [feedCount]);

  return null;
}
