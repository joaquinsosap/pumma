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
/**
 * The public half of the VAPID pair, read at RUNTIME.
 *
 * Deliberately not spelled NEXT_PUBLIC_: that prefix makes Next inline the
 * value into the bundle at BUILD time, and the image is built in CI where no
 * such variable exists — so the deployed app would ship an empty string and
 * report push as unconfigured however carefully the server was set up. The
 * key is public, but it does not need to be baked in: every read of it is
 * server-side, and the settings page already hands it to the browser as a
 * prop.
 *
 * The prefixed spelling is still accepted, because installs configured before
 * this was understood are using it and should not break on an upgrade.
 */
export function vapidPublicKey(): string {
  return (
    process.env.VAPID_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
    ""
  );
}

export function pushConfigured(): boolean {
  return Boolean(vapidPublicKey() && process.env.VAPID_PRIVATE_KEY);
}

let armed = false;
function arm(): boolean {
  if (!pushConfigured()) return false;
  if (armed) return true;
  webpush.setVapidDetails(
    // A contact address, per RFC 8292, so a push service has somebody to
    // complain to. The URL of the app is an acceptable stand-in.
    process.env.VAPID_SUBJECT || "https://pumma.app",
    vapidPublicKey(),
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
