import "server-only";

import webpush from "web-push";
import {
  deletePushByEndpoint,
  listPushSubscriptions,
} from "@/lib/db/notifications";
import type { DeliverableNotification } from "@/lib/notifications-server";

/**
 * Web push, or a no-op.
 *
 * The whole feature degrades cleanly: with no VAPID keys configured the app
 * still schedules, delivers and shows notifications in its own tray — it just
 * cannot reach a browser that is closed. That is the difference between a
 * self-hosted install that skipped a setup step and a broken one.
 */
export function pushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY,
  );
}

let armed = false;
function arm(): boolean {
  if (!pushConfigured()) return false;
  if (armed) return true;
  webpush.setVapidDetails(
    // A contact address, per RFC 8292, so a push service has somebody to
    // complain to. The URL of the app is an acceptable stand-in.
    process.env.VAPID_SUBJECT || "https://pumma.app",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  armed = true;
  return true;
}

/**
 * Send one notification to every device a user has subscribed.
 *
 * A 404 or 410 means that subscription is dead — the browser was uninstalled,
 * the permission revoked, the endpoint expired. Those are pruned on the spot
 * rather than retried, because a dead endpoint never comes back and keeping
 * it means paying for a failed request on every future notification.
 */
export async function pushToUser(
  userId: string,
  payload: DeliverableNotification,
): Promise<{ sent: number; pruned: number }> {
  if (!arm()) return { sent: 0, pruned: 0 };

  const subs = await listPushSubscriptions(userId);
  let sent = 0;
  let pruned = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({
          id: payload.id,
          title: payload.title,
          body: payload.body,
          url: payload.url,
          joinUrl: payload.joinUrl,
          kind: payload.kind,
        }),
        { TTL: 600 },
      );
      sent += 1;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await deletePushByEndpoint(sub.endpoint);
        pruned += 1;
      }
      // Anything else (a 500 from the push service, a timeout) is left alone.
      // The notification is already marked delivered and sits in the tray;
      // retrying a transient failure is not worth a queue.
    }
  }
  return { sent, pruned };
}
