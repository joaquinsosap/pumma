"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/types";
import type { AppNotification } from "@/lib/schemas";
import { requireUserId } from "@/lib/auth/session";
import {
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

export async function markAllNotificationsReadAction(): Promise<
  ActionResult<{ count: number }>
> {
  const userId = await requireUserId();
  const count = await markAllRead(userId);
  return { ok: true, data: { count } };
}

const SNOOZE_MS = 10 * 60_000;

export async function snoozeNotificationAction(
  id: string,
): Promise<ActionResult> {
  const parsed = z.string().max(200).safeParse(id);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const userId = await requireUserId();
  const existing = await getNotification(userId, parsed.data);
  if (!existing) return { ok: false, error: "Not found" };
  await markNotification(userId, parsed.data, {
    status: "scheduled",
    fireAt: new Date(Date.now() + SNOOZE_MS).toISOString(),
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
