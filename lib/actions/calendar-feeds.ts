"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types";
import type { CalendarFeed } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/settings";
import { vetFeedUrl } from "@/lib/calendar-feed-url";
import { syncFeed, syncStaleFeeds } from "@/lib/ics-sync";
import {
  deleteFeed,
  insertFeed,
  listFeeds,
  updateFeed,
} from "@/lib/db/calendar-feeds";

const MAX_FEEDS = 10;

async function userTimezone(userId: string): Promise<string> {
  const settings = await getSettings(userId);
  return settings?.timezone || "UTC";
}

/**
 * Subscribe to a calendar.
 *
 * The first fetch happens inline rather than on a timer, because "did my link
 * work?" is the only question anyone has at this moment, and answering it a
 * quarter of an hour later is not answering it.
 */
export async function addCalendarFeedAction(
  rawUrl: string,
  lifeArea: "personal" | "work",
): Promise<ActionResult<CalendarFeed>> {
  const userId = await requireUserId();

  const vetted = vetFeedUrl(rawUrl);
  if (!vetted.ok) return { ok: false, error: vetted.reason };

  const existing = await listFeeds(userId);
  if (existing.length >= MAX_FEEDS) {
    return { ok: false, error: `That is the limit of ${MAX_FEEDS} calendars.` };
  }
  if (existing.some((f) => f.url === vetted.url)) {
    return { ok: false, error: "That calendar is already here." };
  }

  const feed = await insertFeed({
    userId,
    label: "Calendar",
    url: vetted.url,
    lifeArea,
    color: lifeArea === "work" ? "var(--projects)" : "var(--calendar)",
    enabled: true,
    lastSyncedAt: null,
    lastError: "",
    etag: "",
    lastModified: "",
    createdAt: new Date().toISOString(),
  });

  const res = await syncFeed(userId, feed.id, await userTimezone(userId));
  if (!res.ok) {
    // A link that does not work is not a subscription. Removing it beats
    // leaving a broken row for the user to clean up after.
    await deleteFeed(userId, feed.id);
    return { ok: false, error: res.error };
  }

  revalidatePath("/", "layout");
  const [saved] = (await listFeeds(userId)).filter((f) => f.id === feed.id);
  return { ok: true, data: saved ?? feed };
}

export async function removeCalendarFeedAction(
  id: string,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const gone = await deleteFeed(userId, id);
  if (!gone) return { ok: false, error: "That calendar is already gone." };
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setCalendarFeedEnabledAction(
  id: string,
  enabled: boolean,
): Promise<ActionResult> {
  const userId = await requireUserId();
  await updateFeed(userId, id, { enabled });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** The "refresh now" button, for when waiting for the timer is not the mood. */
export async function refreshCalendarFeedsAction(): Promise<
  ActionResult<{ synced: number; failed: number }>
> {
  const userId = await requireUserId();
  const out = await syncStaleFeeds(userId, await userTimezone(userId), true);
  revalidatePath("/", "layout");
  return { ok: true, data: out };
}
