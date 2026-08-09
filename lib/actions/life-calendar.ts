"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/types";
import { requireUserId } from "@/lib/auth/session";
import { upsertLifeDay } from "@/lib/db/life-days";
import { lifeMoodSchema } from "@/lib/schemas";
import { getSettings } from "@/lib/db/settings";
import { LIFE_SPAN_MAX } from "@/lib/date";
import { buildLifeWeeks, resolveWeekSlotStart } from "@/lib/life-calendar";

const upsertSchema = z.object({
  date: z.string().min(10),
  note: z.string().optional(),
  mood: lifeMoodSchema.nullable().optional(),
});

export async function saveLifeDay(
  input: z.infer<typeof upsertSchema>,
): Promise<ActionResult> {
  const parsed = upsertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const userId = await requireUserId();
  await upsertLifeDay({
    userId,
    date: parsed.data.date.slice(0, 10),
    note: parsed.data.note ?? "",
    mood: parsed.data.mood ?? null,
  });
  revalidatePath("/life");
  return { ok: true };
}

const weekUpsertSchema = z.object({
  weekStart: z.string().min(10),
  note: z.string().optional(),
  mood: lifeMoodSchema.nullable().optional(),
});

export async function saveLifeWeek(
  input: z.infer<typeof weekUpsertSchema>,
): Promise<ActionResult> {
  const parsed = weekUpsertSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const userId = await requireUserId();
  const settings = await getSettings(userId);
  let weekStart = parsed.data.weekStart.slice(0, 10);
  if (settings?.birthDate) {
    const grid = buildLifeWeeks(
      settings.birthDate,
      settings.lifeSpanYears ?? LIFE_SPAN_MAX,
    );
    weekStart = resolveWeekSlotStart(weekStart, grid);
    const slot = grid.find((w) => w.weekStart === weekStart);
    if (slot) {
      const legacyDates = slot.days.filter((d) => d !== weekStart);
      const { removeLifeWeeksByDates } = await import("@/lib/db/life-weeks");
      await removeLifeWeeksByDates(userId, legacyDates);
    }
  }
  const { upsertLifeWeek } = await import("@/lib/db/life-weeks");
  await upsertLifeWeek({
    userId,
    weekStart,
    note: parsed.data.note ?? "",
    mood: parsed.data.mood ?? null,
  });
  revalidatePath("/life");
  return { ok: true };
}
