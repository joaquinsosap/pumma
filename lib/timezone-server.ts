import "server-only";

import { cookies } from "next/headers";
import { getSettings } from "@/lib/db/settings";
import type { Settings } from "@/lib/schemas";
import {
  TIMEZONE_COOKIE,
  getDefaultTimezone,
  isValidTimezone,
  normalizeTimezone,
} from "@/lib/timezone";
import { iso } from "@/lib/date";

/** Pick timezone from cookie or settings — no I/O. */
export function pickTimezone(
  settings: Settings | null | undefined,
  cookieValue?: string | null,
): string {
  if (cookieValue && isValidTimezone(cookieValue)) return cookieValue;
  if (settings?.timezone && isValidTimezone(settings.timezone)) {
    return settings.timezone;
  }
  return getDefaultTimezone();
}

export async function readTimezoneCookie(): Promise<string | undefined> {
  const cookieStore = await cookies();
  const value = cookieStore.get(TIMEZONE_COOKIE)?.value;
  if (value && isValidTimezone(value)) return value;
  return undefined;
}

/**
 * Use when settings are already loaded (layout/page data path).
 * Never hits the DB — avoids a duplicate getSettings per request.
 */
export async function resolveTimezoneFromSettings(
  settings: Settings | null | undefined,
): Promise<string> {
  const fromCookie = await readTimezoneCookie();
  return pickTimezone(settings, fromCookie);
}

/**
 * Server actions. The timezone cookie (set client-side) is authoritative and
 * already validated, so when it's present we skip the getSettings() DB round-trip
 * entirely — this keeps mutations fast. Only fall back to settings (which needs
 * the session user) when there's no cookie yet.
 */
export async function resolveTimezoneWithSettings(): Promise<string> {
  const fromCookie = await readTimezoneCookie();
  if (fromCookie) return fromCookie;
  const { getSessionUserId } = await import("@/lib/auth/session");
  const userId = await getSessionUserId();
  if (!userId) return pickTimezone(null, undefined);
  return pickTimezone(await getSettings(userId), undefined);
}

export async function persistTimezoneCookie(timeZone: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(TIMEZONE_COOKIE, normalizeTimezone(timeZone), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}

export async function userToday(): Promise<{
  timeZone: string;
  today: string;
}> {
  const timeZone = await resolveTimezoneWithSettings();
  return { timeZone, today: iso(new Date(), timeZone) };
}
