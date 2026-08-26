"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/types";
import type { AppNotification } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth/session";
import {
  deleteNotification,
  deletePushSubscription,
  getNotification,
  listNotifications,
  listPushSubscriptions,
  markAllRead,
  markNotification,
} from "@/lib/db/notifications";
import { materializeFor, refreshNotifications } from "@/lib/notifications-server";
import { entityId } from "@/lib/validation";

/**
 * What the tray shows.
 *
 * Materializes first. The alternative is a bell that is only correct if the
 * five-minute planner happened to run since the user's last change, which is
 * exactly the kind of "sometimes wrong" that makes people stop trusting a
 * notification surface.
 */
export async function loadNotificationsAction(): Promise<
  ActionResult<{ items: AppNotification[]; unread: number }>
> {
  const userId = await requireUserId();
  await refreshNotifications(userId);
  const items = await listNotifications(userId, 40);
  return {
    ok: true,
    data: { items, unread: items.filter((n) => n.status === "sent").length },
  };
}

export async function markNotificationReadAction(
  id: string,
): Promise<ActionResult> {
  const parsed = z.string().max(200).safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  const existing = await getNotification(userId, parsed.data);
  if (!existing) return { ok: false, error: "Not found" };
  await markNotification(userId, parsed.data, {
    status: "read",
    readAt: new Date().toISOString(),
  });
  return { ok: true };
}

/**
 * Throw one away, reversibly.
 *
 * Marks it dismissed rather than deleting: it leaves the tray at once and the
 * row survives a few minutes longer, which is what lets Undo work without the
 * browser holding a copy of something it would then have to re-upload. The
 * prune deletes it for real shortly after.
 *
 * Returns the status it had, because undo has to put back the RIGHT one — a
 * dismissed-while-unread notification that came back as read would quietly
 * lose the badge it was owed.
 */
export async function dismissNotificationAction(
  id: string,
): Promise<ActionResult<{ was: "sent" | "read" }>> {
  const parsed = z.string().max(200).safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  const existing = await getNotification(userId, parsed.data);
  if (!existing) return { ok: false, error: "Not found" };
  const was = existing.status === "sent" ? "sent" : "read";
  await markNotification(userId, parsed.data, { status: "dismissed" });
  return { ok: true, data: { was } };
}

/** Put back a notification dismissed a moment ago. */
export async function restoreNotificationAction(
  id: string,
  was: "sent" | "read",
): Promise<ActionResult> {
  const parsed = z
    .object({ id: z.string().max(200), was: z.enum(["sent", "read"]) })
    .safeParse({ id, was });
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  const existing = await getNotification(userId, parsed.data.id);
  // Gone for good: the grace period ran out, or it was never theirs.
  if (!existing) return { ok: false, error: "Too late to undo that" };
  await markNotification(userId, parsed.data.id, {
    status: parsed.data.was,
    readAt: parsed.data.was === "read" ? existing.readAt : null,
  });
  return { ok: true };
}

/** Delete for good, with no undo. Used by the prune, not by the UI. */
export async function deleteNotificationAction(
  id: string,
): Promise<ActionResult> {
  const parsed = z.string().max(200).safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  const gone = await deleteNotification(userId, parsed.data);
  if (!gone) return { ok: false, error: "Not found" };
  return { ok: true };
}

export async function markAllNotificationsReadAction(): Promise<
  ActionResult<{ count: number }>
> {
  const userId = await requireUserId();
  const count = await markAllRead(userId);
  return { ok: true, data: { count } };
}

export async function snoozeNotificationAction(
  id: string,
  minutes = 10,
): Promise<ActionResult> {
  const parsed = z
    .object({
      id: z.string().max(200),
      minutes: z.number().int().min(1).max(1440),
    })
    .safeParse({ id, minutes });
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  const existing = await getNotification(userId, parsed.data.id);
  if (!existing) return { ok: false, error: "Not found" };
  // Back to scheduled on the same row. A snoozed reminder is the same
  // reminder, not a second one about the same meeting.
  await markNotification(userId, parsed.data.id, {
    status: "scheduled",
    fireAt: new Date(Date.now() + parsed.data.minutes * 60_000).toISOString(),
    sentAt: null,
  });
  return { ok: true };
}

/** Devices currently able to receive push, for the Settings list. */
export async function listPushDevicesAction(): Promise<
  ActionResult<{ devices: { id: string; label: string; createdAt: string }[] }>
> {
  const userId = await requireUserId();
  const devices = (await listPushSubscriptions(userId)).map((d) => ({
    id: d.id,
    label: d.label,
    createdAt: d.createdAt,
  }));
  return { ok: true, data: { devices } };
}

export async function removePushDeviceAction(
  id: string,
): Promise<ActionResult> {
  const parsed = entityId.safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  await deletePushSubscription(userId, parsed.data);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Rebuild after a settings change.
 *
 * Separate from updateSettingsAction so the settings write stays a settings
 * write: turning a toggle off should not be able to fail because a reminder
 * could not be recalculated.
 */
export async function refreshNotificationsAction(): Promise<ActionResult> {
  const userId = await requireUserId();
  try {
    await materializeFor(userId);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not refresh reminders" };
  }
}
