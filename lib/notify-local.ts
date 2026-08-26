"use client";

import type { AppNotification } from "@/lib/schemas";

/**
 * An OS notification raised by the PAGE, with no push involved.
 *
 * This is the tier that was missing. There are three, and they cover
 * different situations rather than being alternatives:
 *
 *   1. Tab open and looked at    -> the in-app pill. No permission needed.
 *   2. Tab open, but hidden      -> THIS. Needs notification permission and
 *      (another tab, minimised,     nothing else: no VAPID keys, no server
 *       another app in front)       push, no subscription. The page is still
 *                                   running, so it can raise a banner itself.
 *   3. App closed entirely       -> web push, which needs all of the above.
 *
 * Skipping (2) meant somebody with PUMMA open behind their editor got nothing
 * unless push was fully configured and enabled, which is a lot of machinery
 * to demand for "tell me about my meeting while I am looking at something
 * else on the same computer".
 *
 * Raised through the service worker registration rather than `new
 * Notification()` on purpose: it is the only form Android accepts at all, and
 * it routes clicks through the worker's own `notificationclick` handler, so a
 * locally-raised banner behaves exactly like a pushed one — same Join button,
 * same focus-the-tab-and-open-the-sheet behaviour.
 */
export async function showLocalNotification(
  n: AppNotification,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return false;
  }
  if (!("serviceWorker" in navigator)) return false;

  try {
    const reg = await navigator.serviceWorker.ready;
    const actions: { action: string; title: string }[] = [];
    if (n.joinUrl) actions.push({ action: "join", title: "Join" });
    if (n.kind === "task") actions.push({ action: "done", title: "Done" });
    actions.push({ action: "snooze", title: "Snooze 10m" });

    await reg.showNotification(n.title, {
      body: n.body,
      // The notification's own id, which is also what a pushed copy would
      // use. If both arrive — the tab raised one and the server pushed the
      // same reminder — the second replaces the first instead of stacking.
      tag: n.id,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { id: n.id, url: n.url, joinUrl: n.joinUrl },
      actions,
    } as NotificationOptions);
    return true;
  } catch {
    // A browser that refuses (Safari on macOS rejects `actions`, older
    // engines reject the whole call) still has the bell and the pill.
    return false;
  }
}
