import { formatTimeHM, iso, parseTimeToMinutes } from "@/lib/date";
import type { Task } from "@/lib/schemas";

export const CALENDAR_PRIO = {
  high: "oklch(0.64 0.18 25)",
  med: "oklch(0.7 0.12 70)",
  low: "oklch(0.58 0.14 245)",
} as const;

export function calendarPrioBg(color: string): string {
  return color.replace(")", " / 0.1)");
}

export function isMeetingTask(task: Task): boolean {
  return Boolean(task.due?.includes("T"));
}

export function meetingTimeLabel(due: string): string {
  return due.split("T")[1]?.slice(0, 5) ?? "";
}

export function meetingSortKey(due: string | null): number {
  if (!due?.includes("T")) return 9999;
  return parseTimeToMinutes(due.split("T")[1] ?? "00:00");
}

/** Whether a timed task on `day` has already started (or the whole day is in the past). */
export function isMeetingPast(
  due: string,
  day: string,
  now: Date = new Date(),
  timeZone?: string,
): boolean {
  const today = iso(now, timeZone);
  if (day < today) return true;
  if (day > today) return false;
  if (!due.includes("T")) return false;
  const nowMins = parseTimeToMinutes(formatTimeHM(now, timeZone));
  return parseTimeToMinutes(due.split("T")[1] ?? "00:00") < nowMins;
}

export function sortCalendarDayTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const aMeeting = isMeetingTask(a);
    const bMeeting = isMeetingTask(b);
    if (aMeeting && bMeeting) {
      return meetingSortKey(a.due) - meetingSortKey(b.due);
    }
    if (aMeeting !== bMeeting) return aMeeting ? -1 : 1;
    return 0;
  });
}
