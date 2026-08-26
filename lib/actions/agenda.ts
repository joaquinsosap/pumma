"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/types";
import type { AgendaItem } from "@/lib/schemas";
import {
  insertAgendaItem,
  getAgendaItem,
  updateAgendaItem,
  deleteAgendaItem,
} from "@/lib/db/agenda";
import { requireUserId } from "@/lib/auth/session";
import { entityId, isoDate, title } from "@/lib/validation";
import { OWN_MEETING_COLOR } from "@/lib/calendar-colors";

// One colour for everything PUMMA owns. Work vs personal is already carried
// by the life filter; what this colour answers is "mine or mirrored", and it
// used to answer nothing because the work shade matched a subscribed feed's
// default exactly. See lib/calendar-colors.
const MEETING_COLORS = {
  work: OWN_MEETING_COLOR,
  personal: OWN_MEETING_COLOR,
} as const;

const timeField = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time");

const recurrenceInput = z
  .object({
    freq: z.enum(["daily", "weekly", "monthly"]),
    interval: z.number().int().min(1).max(52).default(1),
    byWeekday: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    until: isoDate.nullable().default(null),
    count: z.number().int().min(1).max(730).nullable().default(null),
  })
  .strict()
  // "Ends on a date" and "ends after N times" are mutually exclusive, exactly
  // like every calendar UI — accepting both would make the series ambiguous.
  .refine((r) => !(r.until && r.count != null), {
    message: "Pick either an end date or a number of occurrences, not both",
  });

const meetingSchema = z
  .object({
    title,
    date: isoDate,
    time: timeField,
    durationMins: z.number().int().min(5).max(600),
    lifeArea: z.enum(["personal", "work"]),
    notes: z.string().max(1000).default(""),
    recurrence: recurrenceInput.nullable().default(null),
  })
  .strict();

export type MeetingInput = z.input<typeof meetingSchema>;

/** Keep `sub` as the human one-liner shown under the title in the agenda. */
function subLine(durationMins: number, notes: string): string {
  const base = `meeting · ${durationMins} min`;
  const trimmed = notes.trim();
  return trimmed ? `${base} · ${trimmed.slice(0, 80)}` : base;
}

export async function addMeetingAction(
  input: MeetingInput,
): Promise<ActionResult<AgendaItem>> {
  const parsed = meetingSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const {
    title: t,
    date,
    time,
    durationMins,
    lifeArea,
    notes,
    recurrence,
  } = parsed.data;
  const userId = await requireUserId();
  const item = await insertAgendaItem({
    userId,
    title: t,
    time,
    sub: subLine(durationMins, notes),
    color: MEETING_COLORS[lifeArea],
    lifeArea,
    date,
    kind: "meeting",
    durationMins,
    notes,
    recurrence,
    exceptions: [],
  });
  revalidatePath("/", "layout");
  return { ok: true, data: item };
}

const updateSchema = meetingSchema.partial().extend({ id: entityId }).strict();

export async function updateMeetingAction(
  input: z.input<typeof updateSchema>,
): Promise<ActionResult<AgendaItem>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const { id, ...patch } = parsed.data;
  const userId = await requireUserId();
  const existing = await getAgendaItem(userId, id);
  if (!existing) return { ok: false, error: "Meeting not found" };

  const durationMins = patch.durationMins ?? existing.durationMins;
  const notes = patch.notes ?? existing.notes;
  const lifeArea = patch.lifeArea ?? existing.lifeArea;

  const updated = await updateAgendaItem(userId, id, {
    ...patch,
    lifeArea,
    durationMins,
    notes,
    color: MEETING_COLORS[lifeArea],
    sub: subLine(durationMins, notes),
    // Changing the rule invalidates per-occurrence skips — they were pinned to
    // dates the old rule generated, so keeping them would silently blank days.
    ...(patch.recurrence !== undefined ? { exceptions: [] } : {}),
  });
  if (!updated) return { ok: false, error: "Meeting not found" };
  revalidatePath("/", "layout");
  return { ok: true, data: updated };
}

const deleteSchema = z
  .object({
    id: entityId,
    scope: z.enum(["occurrence", "series"]).default("series"),
    /** Required for scope "occurrence": which day to drop. */
    date: isoDate.optional(),
  })
  .strict();

/**
 * Delete a whole series, or skip a single day of a repeating meeting (which
 * records an exception rather than destroying the series).
 */
export async function deleteMeetingAction(
  input: z.input<typeof deleteSchema>,
): Promise<ActionResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { id, scope, date } = parsed.data;
  const userId = await requireUserId();

  if (scope === "occurrence") {
    if (!date) return { ok: false, error: "Missing date" };
    const existing = await getAgendaItem(userId, id);
    if (!existing) return { ok: false, error: "Meeting not found" };
    // A one-off has nothing to except — just remove the row.
    if (!existing.recurrence) {
      const ok = await deleteAgendaItem(userId, id);
      if (!ok) return { ok: false, error: "Meeting not found" };
    } else if (!existing.exceptions.includes(date)) {
      await updateAgendaItem(userId, id, {
        exceptions: [...existing.exceptions, date],
      });
    }
    revalidatePath("/", "layout");
    return { ok: true };
  }

  const ok = await deleteAgendaItem(userId, id);
  if (!ok) return { ok: false, error: "Meeting not found" };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Legacy single-row delete (also removes leftover demo "routine" rows). */
export async function deleteAgendaItemAction(
  id: string,
): Promise<ActionResult> {
  const parsed = entityId.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid id" };
  const userId = await requireUserId();
  const ok = await deleteAgendaItem(userId, parsed.data);
  if (!ok) return { ok: false, error: "Item not found" };
  revalidatePath("/", "layout");
  return { ok: true };
}
