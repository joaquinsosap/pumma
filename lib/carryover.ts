import { daysBetween } from "@/lib/date";

/**
 * How far back the unfinished pile reaches, in words.
 *
 * "2 unfinished" is a count with no weight to it. The same two tasks left
 * over from yesterday and left over from a week ago are not the same
 * situation, and the number alone says nothing about which one you are in.
 *
 * Measured from the OLDEST thing in the pile, because that is the part that
 * stings, and phrased as a span rather than a date so it stays readable at
 * a glance: nobody reads "since 3 Aug" as a length of time.
 *
 * Deliberately not calendar-week arithmetic. "Last week" would then mean the
 * previous Monday-to-Sunday block, which depends on the week-start setting
 * and would call something from six days ago "this week" or "last week"
 * depending on which day you happened to open the app. A week back is a week
 * back.
 */
export function carryoverSpanLabel(
  dueDates: string[],
  today: string,
): string | null {
  const ages = dueDates
    .map((d) => daysBetween(d.slice(0, 10), today))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!ages.length) return null;

  const oldest = Math.max(...ages);
  if (oldest === 1) return "yesterday";
  if (oldest >= 7) return "last week";
  // "5 days ago" rather than "the last 5 days": this is the age of the oldest
  // one, not a range, and saying range when you mean age is the sort of small
  // lie a label gets away with until someone checks.
  return `${oldest} days ago`;
}
