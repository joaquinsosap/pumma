import { getSettings } from "@/lib/db/settings";
import { LIFE_SPAN_MAX } from "@/lib/date";
import { buildLifeWeeks, resolveWeekSlotStart } from "@/lib/life-calendar";
import {
  listLifeWeeks,
  upsertLifeWeek,
  removeLifeWeeksByDates,
} from "@/lib/db/life-weeks";

/** Rewrite legacy weekStart keys (e.g. week end) to birth-aligned grid slots. */
export async function normalizeLifeWeekKeys(userId: string): Promise<void> {
  const settings = await getSettings(userId);
  if (!settings?.birthDate) return;

  const grid = buildLifeWeeks(
    settings.birthDate,
    settings.lifeSpanYears ?? LIFE_SPAN_MAX,
  );
  const weeks = await listLifeWeeks(userId);

  for (const w of weeks) {
    const saved = w.weekStart.slice(0, 10);
    const canonical = resolveWeekSlotStart(saved, grid);
    if (canonical === saved) continue;

    await removeLifeWeeksByDates(userId, [saved]);
    await upsertLifeWeek({
      userId,
      weekStart: canonical,
      note: w.note,
      mood: w.mood,
    });
  }
}
