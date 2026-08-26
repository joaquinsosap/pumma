"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types";
import type { CalendarFeed } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth/session";
import { getSettings } from "@/lib/db/settings";
import { vetFeedUrl } from "@/lib/calendar-feed-url";
import { FEED_PALETTE, nextFeedColor } from "@/lib/calendar-colors";
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
    // Assigned rather than derived from life area: two work calendars
    // would otherwise arrive identical, which is the whole problem.
    color: nextFeedColor(existing.map((f) => f.color)),
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

/**
 * Give a calendar a name you will recognise.
 *
 * Feeds name themselves from X-WR-CALNAME, which Google fills in with the
 * account and Outlook fills in with "Calendar" — so two Outlook subscriptions
 * arrive indistinguishable. The nickname is per-subscription and purely
 * visual; nothing is sent anywhere.
 */
export async function renameCalendarFeedAction(
  id: string,
  label: string,
): Promise<ActionResult> {
  const userId = await requireUserId();
  const next = label.trim().slice(0, 80);
  if (!next) return { ok: false, error: "Give it a name." };
  const saved = await updateFeed(userId, id, { label: next });
  if (!saved) return { ok: false, error: "That calendar is gone." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Recolour a subscription. Purely visual, and the point of the palette. */
export async function setCalendarFeedColorAction(
  id: string,
  color: string,
): Promise<ActionResult> {
  const userId = await requireUserId();
  if (!FEED_PALETTE.some((c) => c.value === color)) {
    return { ok: false, error: "That is not one of the colours." };
  }
  await updateFeed(userId, id, { color });
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

/**
 * Refresh anything that has gone stale, if anything has.
 *
 * Called from the client while somebody is actually looking at the app. That
 * is deliberate: a cron would fetch every feed for every account around the
 * clock, including the ones nobody has opened in a month, and this is a
 * personal tool whose users are asleep two thirds of the day. Tying the work
 * to attention means the cost scales with use rather than with the user
 * table.
 *
 * Cheap when there is nothing to do: `syncStaleFeeds` checks timestamps
 * first, so the common call touches the database and returns.
 */
export async function syncStaleCalendarsAction(): Promise<
  ActionResult<{ synced: number; failed: number }>
> {
  const userId = await requireUserId();
  const out = await syncStaleFeeds(userId, await userTimezone(userId), false);
  // Only when something actually changed. Revalidating the layout on every
  // poll would re-render the whole app every few minutes to show the same
  // thing, which is worse than the staleness it is fixing.
  if (out.synced > 0) revalidatePath("/", "layout");
  return { ok: true, data: out };
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
