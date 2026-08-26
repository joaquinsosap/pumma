"use client";

import { useEffect } from "react";
import { TIMEZONE_COOKIE } from "@/lib/timezone";
import { syncTimezoneAction } from "@/lib/actions/settings";

/**
 * Writes the browser's IANA timezone into the `pumma-timezone` cookie once, if it
 * isn't already set. This makes date math use the user's real timezone out of the
 * box, and — because server reads are cookie-first — lets server actions resolve
 * the timezone without a getSettings() DB round-trip. Never overrides an existing
 * cookie (e.g. one the user set explicitly in Settings).
 *
 * It also persists the zone into settings, which the cookie alone cannot
 * cover: work that runs on a timer rather than inside a request has no cookie
 * to read, and the notification planner is exactly that. Planning in UTC for
 * somebody three hours off puts every reminder three hours out. The action
 * refuses to overwrite a zone somebody actually chose.
 */
export function TimezoneSync() {
  useEffect(() => {
    let tz = "";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    } catch {
      return; // server falls back to settings/default
    }
    if (!tz) return;

    if (!document.cookie.includes(`${TIMEZONE_COOKIE}=`)) {
      document.cookie = `${TIMEZONE_COOKIE}=${tz}; path=/; max-age=31536000; SameSite=Lax`;
    }
    // Runs even when the cookie was already there: the cookie is per browser,
    // the setting is per account, and a second device is how the stored one
    // gets filled in for somebody who has been using the app for months.
    void syncTimezoneAction(tz);
  }, []);
  return null;
}
