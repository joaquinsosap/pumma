import { buildLifeWeeks, clampLifeSpanYears } from "@/lib/life-calendar";
import { LIFE_SPAN_DEFAULT } from "@/lib/life-constants";
import {
  dateLabel,
  daysInMonth,
  iso,
  isoWeekNumber,
  isoWeeksInYear,
  workweekDay,
} from "@/lib/date";
import { normalizeTimezone } from "@/lib/timezone";

export type TopbarDateContext = {
  birthDate?: string | null;
  lifeSpanYears?: number;
  timeZone?: string;
};

export { isoWeekNumber, isoWeeksInYear, daysInMonth, workweekDay };

export function lifeWeekProgress(
  birthDate: string,
  spanYears: number = LIFE_SPAN_DEFAULT,
  today: string = iso(),
  timeZone?: string,
): { lived: number; total: number } {
  const span = clampLifeSpanYears(spanYears);
  const weeks = buildLifeWeeks(birthDate, span);
  const total = weeks.length;
  const todayStr = today.slice(0, 10);
  if (todayStr < birthDate.slice(0, 10)) return { lived: 0, total };

  const slot = weeks.find((w) => w.days.includes(todayStr));
  const lived =
    slot?.weekIndex ?? weeks.filter((w) => w.weekEnd < todayStr).length;
  return { lived, total };
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Rich date line for the top bar, e.g. SUNDAY, JUNE 28 · DAY 28/30 · … */
export function formatTopbarDateLine(
  d: Date = new Date(),
  ctx: TopbarDateContext = {},
): string {
  const tz = normalizeTimezone(ctx.timeZone);
  const parts: string[] = [dateLabel(d, tz)];

  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    day: "numeric",
    month: "short",
  })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  const day = Number(p.day);
  const monthDays = daysInMonth(d, tz);
  const month = (p.month ?? "").toUpperCase();
  parts.push(`DAY ${day}/${monthDays} ${month}`);

  const week = isoWeekNumber(d, tz);
  const weeksInYear = isoWeeksInYear(
    Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
      }).format(d),
    ),
  );
  parts.push(`WEEK ${week}/${weeksInYear}`);

  if (ctx.birthDate) {
    const { lived, total } = lifeWeekProgress(
      ctx.birthDate,
      ctx.lifeSpanYears ?? LIFE_SPAN_DEFAULT,
      iso(d, tz),
      tz,
    );
    parts.push(`LIFE WEEK ${formatCount(lived)}/${formatCount(total)}`);
  }

  const work = workweekDay(d, tz);
  if (work) {
    parts.push(`${work.label} ${work.day}/5`);
  } else {
    parts.push("WEEKEND");
  }

  parts.push(`Q${quarterOf(d, tz)}`);

  return parts.join(" · ");
}

/** Calendar quarter (1–4) for a date, in the given timezone. */
export function quarterOf(d: Date = new Date(), timeZone?: string): number {
  const monthNum = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: normalizeTimezone(timeZone),
      month: "numeric",
    }).format(d),
  );
  return Math.floor((monthNum - 1) / 3) + 1;
}
