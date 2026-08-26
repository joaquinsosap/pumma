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
    // Registered in development too. It was skipped there at first, on the
    // grounds that a dev reload churns the worker for no benefit — but the
    // worker is also what makes the browser consider the app installable, so
    // skipping it meant localhost could never show the Install button and the
    // whole install path was untestable without deploying. Behaving the same
    // in both places is worth more than avoiding the churn.
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* an unavailable worker costs push, not the app */
    });
  }, []);

  return null;
}
