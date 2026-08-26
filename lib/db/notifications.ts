import { cache } from "react";
import * as memory from "./memory/notifications";
import * as mongo from "./mongo/notifications";

const impl = process.env.DATA_SOURCE === "mongodb" ? mongo : memory;

export const upsertNotification = impl.upsertNotification;
// Cached: the bell, the tray and the focus sheet all read this in one render.
export const listNotifications = cache(impl.listNotifications);
export const getNotification = impl.getNotification;
export const dueNotifications = impl.dueNotifications;
export const markNotification = impl.markNotification;
export const markAllRead = impl.markAllRead;
export const deleteScheduledFor = impl.deleteScheduledFor;
export const scheduledIds = impl.scheduledIds;
export const deleteNotifications = impl.deleteNotifications;
export const deleteNotification = impl.deleteNotification;
export const pruneNotifications = impl.pruneNotifications;

export const listPushSubscriptions = cache(impl.listPushSubscriptions);
export const upsertPushSubscription = impl.upsertPushSubscription;
export const deletePushSubscription = impl.deletePushSubscription;
export const deletePushByEndpoint = impl.deletePushByEndpoint;
export const usersWithPush = impl.usersWithPush;
