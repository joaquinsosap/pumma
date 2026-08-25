"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/types";
import { requireUserId } from "@/lib/auth/session";
import { listTags } from "@/lib/db/tags";
import { getSettings } from "@/lib/db/settings";
import { deriveLifeAreaFromTags, setLifeTags } from "@/lib/life-area-sync";
import { userToday } from "@/lib/timezone-server";
import { entityId, isoDate, title } from "@/lib/validation";
import {
  deleteHabit,
  insertHabit,
  listHabits,
  updateHabit,
  updateHabitsOrder,
} from "@/lib/db/habits";
import {
  toggleHabitEntry,
  habitEntriesInRange,
  clearHabitEntriesInRange,
  markHabitEntry,
} from "@/lib/db/habitEntries";

/** Confirm the habit belongs to the caller before writing an entry for it, so a
 *  crafted call can't seed entry rows against a non-owned/nonexistent habitId. */
async function ownsHabit(userId: string, habitId: string): Promise<boolean> {
  const habits = await listHabits(userId);
  return habits.some((h) => h.id === habitId);
}

export async function toggleHabitToday(habitId: string): Promise<ActionResult> {
  const parsed = entityId.safeParse(habitId);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  if (!(await ownsHabit(userId, parsed.data)))
    return { ok: false, error: "Not found" };
  const { today: td } = await userToday();
  await toggleHabitEntry(userId, parsed.data, td);
  revalidatePath("/", "layout");
  return { ok: true };
}

const toggleDateSchema = z.object({ habitId: entityId, date: isoDate });

const togglePeriodSchema = z.object({
  habitId: entityId,
  start: isoDate,
  end: isoDate,
  markDate: isoDate,
});

/**
 * Toggle a whole period (the week or month a box stands for), not one date.
 *
 * A weekly box reads as done when ANY entry falls inside its week, so undoing
 * it has to clear the whole week — otherwise leftover entries (e.g. from when
 * the habit was still daily) keep it green no matter how often you uncheck.
 */
export async function toggleHabitPeriod(input: {
  habitId: string;
  start: string;
  end: string;
  markDate: string;
}): Promise<ActionResult<{ done: boolean }>> {
  const parsed = togglePeriodSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { habitId, start, end, markDate } = parsed.data;
  if (end < start) return { ok: false, error: "Invalid range" };

  const userId = await requireUserId();
  if (!(await ownsHabit(userId, habitId)))
    return { ok: false, error: "Not found" };

  const existing = await habitEntriesInRange(userId, habitId, start, end);
  if (existing.length) {
    await clearHabitEntriesInRange(userId, habitId, start, end);
    revalidatePath("/", "layout");
    return { ok: true, data: { done: false } };
  }

  // Only mark inside the period the box represents.
  const date = markDate >= start && markDate <= end ? markDate : end;
  await markHabitEntry(userId, habitId, date);
  revalidatePath("/", "layout");
  return { ok: true, data: { done: true } };
}

export async function toggleHabitDate(
  habitId: string,
  date: string,
): Promise<ActionResult> {
  const parsed = toggleDateSchema.safeParse({ habitId, date });
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  if (!(await ownsHabit(userId, parsed.data.habitId)))
    return { ok: false, error: "Not found" };
  await toggleHabitEntry(userId, parsed.data.habitId, parsed.data.date);
  revalidatePath("/", "layout");
  return { ok: true };
}

const nameSchema = z.object({
  name: title,
  lifeView: z.enum(["personal", "work", "both"]).optional(),
});

export async function addHabitAction(
  input: z.infer<typeof nameSchema>,
): Promise<ActionResult> {
  const parsed = nameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid name" };
  const userId = await requireUserId();
  const { today: td } = await userToday();
  // A habit belongs to a side of life like everything else, and the tags are
  // the only place that lives.
  const tags = await listTags(userId);
  const tagIds = setLifeTags([], parsed.data.lifeView ?? "personal", tags);
  // A new habit starts on the cadence the user chose in Settings. Target 1
  // regardless: "how many times" is a per-habit edit, the cadence is a taste.
  const settings = await getSettings(userId);
  await insertHabit({
    userId,
    name: parsed.data.name,
    color: "oklch(0.6 0.13 155)",
    frequency: {
      type: settings?.defaultHabitFrequency ?? "daily",
      target: 1,
    },
    order: 999,
    archived: false,
    goalIds: [],
    goalTargetStreak: null,
    tagIds,
    lifeArea: deriveLifeAreaFromTags(tagIds, tags),
    createdAt: td,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

const renameSchema = z.object({ id: entityId, name: title });

export async function renameHabit(
  id: string,
  name: string,
): Promise<ActionResult> {
  const parsed = renameSchema.safeParse({ id, name });
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  await updateHabit(userId, parsed.data.id, { name: parsed.data.name });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function archiveHabit(id: string): Promise<ActionResult> {
  const parsed = entityId.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  const { listHabits } = await import("@/lib/db/habits");
  const habits = await listHabits(userId);
  const h = habits.find((x) => x.id === parsed.data);
  if (!h) return { ok: false, error: "Not found" };
  await updateHabit(userId, parsed.data, { archived: !h.archived });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteHabitAction(id: string): Promise<ActionResult> {
  const parsed = entityId.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  // Permanently removes the habit AND its entry history (unlike archive).
  const deleted = await deleteHabit(userId, parsed.data);
  if (!deleted) return { ok: false, error: "Not found" };
  revalidatePath("/", "layout");
  return { ok: true };
}

const frequencySchema = z.object({
  type: z.enum(["daily", "weekly", "monthly"]),
  target: z.number().min(1).max(31).optional(),
  // Weekdays a daily habit runs on. Deduped and sorted before storing so
  // two habits with the same schedule always compare equal.
  days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});

export async function updateHabitFrequencyAction(
  id: string,
  frequency: z.infer<typeof frequencySchema>,
): Promise<ActionResult> {
  const idParsed = entityId.safeParse(id);
  const parsed = frequencySchema.safeParse(frequency);
  if (!idParsed.success || !parsed.success) {
    return { ok: false, error: "Invalid input" };
  }
  const userId = await requireUserId();
  // Only a daily habit has weekdays; a weekly one carrying them would be a
  // schedule nothing reads. And "all seven" is the same thing as unset, so
  // it is stored as unset rather than as a list that means nothing.
  const days =
    parsed.data.type === "daily" && parsed.data.days?.length
      ? [...new Set(parsed.data.days)].sort((a, b) => a - b)
      : undefined;
  await updateHabit(userId, idParsed.data, {
    frequency: {
      type: parsed.data.type,
      target: parsed.data.target ?? 1,
      ...(days && days.length < 7 ? { days } : {}),
    },
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

const orderSchema = z.array(entityId).max(200);

/**
 * Persist a drag-reorder. The array position is the order, so the client
 * sends what it shows and never computes an index.
 *
 * Home reads the same `order`, so a habit dragged to the top here is at the
 * top there too — which is the whole point of being able to drag it.
 */
export async function updateHabitsOrderAction(
  ids: string[],
): Promise<ActionResult> {
  const parsed = orderSchema.safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  await updateHabitsOrder(userId, parsed.data);
  revalidatePath("/", "layout");
  return { ok: true };
}
