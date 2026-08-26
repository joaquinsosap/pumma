"use client";

import { useEffect } from "react";

/**
 * Registers the service worker. Nothing else.
 *
 * Registration is not permission: this asks for nothing, shows nothing, and
 * happens on every load so the worker is already in place by the time
 * somebody presses the button in Settings. Asking for notification permission
 * on page load is the single most reliable way to get told no forever, so the
 * prompt lives behind an explicit press and nowhere else.
 */
export function ServiceWorkerBridge() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Dev builds churn the worker on every reload for no benefit, and an
    // unregistered-then-registered worker mid-session breaks the message
    // channel the notification click path depends on.
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* an unavailable worker costs push, not the app */
    });
  }, []);

  return null;
}
