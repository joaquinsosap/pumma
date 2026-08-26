import "server-only";

import { lookup } from "node:dns/promises";
import { isBlockedHost, vetFeedUrl } from "@/lib/calendar-feed-url";
import { parseIcs } from "@/lib/ics";
import { addDays, iso } from "@/lib/date";
import {
  getFeed,
  listFeeds,
  replaceFeedEvents,
  updateFeed,
} from "@/lib/db/calendar-feeds";

/**
 * Fetching somebody else's calendar, safely.
 *
 * How much of a feed to keep. Enough history that last week's meeting is still
 * there to look back at, enough future that planning works, and not so much
 * that one enthusiastic recurring event fills the database.
 */
const WINDOW_BACK_DAYS = 45;
const WINDOW_FORWARD_DAYS = 240;

/**
 * How old a feed has to be before it is worth fetching again.
 *
 * Five minutes, not thirty. The publishers cache far longer than this — a
 * Google secret feed can sit on a change for hours — so a short window here
 * does not make anything more live. What it does is make the delay OURS
 * rather than ours plus theirs, and stop the answer to "why is it not there"
 * being a button somebody has to remember to press.
 *
 * Cheap to be wrong about: a poll that finds nothing costs one conditional
 * GET, and against a publisher that sends an ETag it costs only headers.
 */
export const STALE_AFTER_MS = 5 * 60 * 1000;

/** Big enough for a busy year, small enough that a hostile feed cannot OOM us. */
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export type SyncResult =
  | { ok: true; events: number; unchanged: boolean }
  | { ok: false; error: string };

/**
 * The second half of the SSRF defence.
 *
 * `vetFeedUrl` rejects what is wrong on its face, but a hostname is not an
 * address: "calendar.example.com" is free to resolve to 127.0.0.1, and that is
 * a deliberate attack, not a hypothetical. So the name is resolved here and
 * the ANSWER is checked before anything connects.
 *
 * This still leaves a rebinding window (the address could change between this
 * lookup and fetch's own). Closing it properly needs a custom agent that pins
 * the socket to the address we checked. Worth doing if this ever accepts
 * feeds from untrusted users; for a personal tool the narrowed window plus
 * the literal checks is a reasonable place to stop, and saying so is better
 * than implying it is airtight.
 */
async function resolvesToPublicAddress(host: string): Promise<boolean> {
  try {
    const answers = await lookup(host, { all: true, verbatim: true });
    if (answers.length === 0) return false;
    return answers.every((a) => !isBlockedHost(a.address));
  } catch {
    return false;
  }
}

/**
 * Pull one feed and replace its cached events.
 *
 * Never throws: a broken feed is a normal state that the user needs told
 * about, not an exception that takes a page render down with it.
 */
export async function syncFeed(
  userId: string,
  feedId: string,
  timeZone: string,
): Promise<SyncResult> {
  const feed = await getFeed(userId, feedId);
  if (!feed) return { ok: false, error: "That calendar is gone." };

  const vetted = vetFeedUrl(feed.url);
  if (!vetted.ok) {
    await updateFeed(userId, feedId, { lastError: vetted.reason });
    return { ok: false, error: vetted.reason };
  }

  const url = new URL(vetted.url);
  if (!(await resolvesToPublicAddress(url.hostname))) {
    const reason = "That address is not reachable from PUMMA.";
    await updateFeed(userId, feedId, { lastError: reason });
    return { ok: false, error: reason };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      // Some publishers serve HTML to a browser-looking client and the real
      // calendar to anything else.
      Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
      "User-Agent": "PUMMA-calendar-sync",
    };
    // Conditional GET, so a poll that changes nothing costs a header exchange
    // instead of a megabyte.
    if (feed.etag) headers["If-None-Match"] = feed.etag;
    if (feed.lastModified) headers["If-Modified-Since"] = feed.lastModified;

    const res = await fetch(vetted.url, {
      headers,
      signal: controller.signal,
      // Following a redirect would walk straight past every check above.
      redirect: "manual",
      cache: "no-store",
    });

    if (res.status >= 300 && res.status < 400) {
      const reason = "That link redirects somewhere else. Use the direct URL.";
      await updateFeed(userId, feedId, { lastError: reason });
      return { ok: false, error: reason };
    }

    if (res.status === 304) {
      await updateFeed(userId, feedId, {
        lastSyncedAt: new Date().toISOString(),
        lastError: "",
      });
      return { ok: true, events: -1, unchanged: true };
    }

    if (!res.ok) {
      const reason =
        res.status === 404
          ? "That calendar link is not there any more."
          : res.status === 401 || res.status === 403
            ? "That calendar is private. Republish it and use the new link."
            : `The calendar server said ${res.status}.`;
      await updateFeed(userId, feedId, { lastError: reason });
      return { ok: false, error: reason };
    }

    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) {
      const reason = "That calendar is too large to sync.";
      await updateFeed(userId, feedId, { lastError: reason });
      return { ok: false, error: reason };
    }

    const text = await res.text();
    if (text.length > MAX_BYTES) {
      const reason = "That calendar is too large to sync.";
      await updateFeed(userId, feedId, { lastError: reason });
      return { ok: false, error: reason };
    }

    const parsed = parseIcs(
      text,
      timeZone,
      iso(addDays(-WINDOW_BACK_DAYS)),
      iso(addDays(WINDOW_FORWARD_DAYS)),
    );

    const kept = parsed.occurrences.filter((o) => !o.cancelled);
    const count = await replaceFeedEvents(
      userId,
      feedId,
      kept.map((o) => ({
        key: o.key,
        title: o.title,
        date: o.date,
        time: o.time,
        durationMins: o.durationMins,
        allDay: o.allDay,
        location: o.location,
        notes: o.description.slice(0, 2000),
      })),
    );

    await updateFeed(userId, feedId, {
      lastSyncedAt: new Date().toISOString(),
      lastError: "",
      etag: res.headers.get("etag") ?? "",
      lastModified: res.headers.get("last-modified") ?? "",
      // A feed that names itself gets to, unless the user renamed it.
      ...(feed.label === "Calendar" && parsed.calendarName
        ? { label: parsed.calendarName.slice(0, 80) }
        : {}),
    });
    return { ok: true, events: count, unchanged: false };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? "That calendar server took too long to answer."
        : err instanceof Error && /Not a calendar feed/.test(err.message)
          ? "That link does not return a calendar."
          : "Could not reach that calendar.";
    await updateFeed(userId, feedId, { lastError: reason });
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/** Refresh whatever has gone stale. Used by the cron and by a manual refresh. */
export async function syncStaleFeeds(
  userId: string,
  timeZone: string,
  force = false,
): Promise<{ synced: number; failed: number }> {
  const feeds = await listFeeds(userId);
  let synced = 0;
  let failed = 0;
  for (const feed of feeds) {
    if (!feed.enabled) continue;
    if (!force && feed.lastSyncedAt) {
      const age = Date.now() - new Date(feed.lastSyncedAt).getTime();
      if (age < STALE_AFTER_MS) continue;
    }
    const res = await syncFeed(userId, feed.id, timeZone);
    if (res.ok) synced += 1;
    else failed += 1;
  }
  // A sync that pulled in events changed what should be reminded about. Only
  // when something actually moved: an unchanged poll is the common case and
  // re-planning on every one of them would be work with no output.
  if (synced > 0) {
    const { refreshNotifications } = await import("@/lib/notifications-server");
    await refreshNotifications(userId);
  }
  return { synced, failed };
}
