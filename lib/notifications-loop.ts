import "server-only";

import { collectDue, materializeFor } from "@/lib/notifications-server";
import { pushToUser, pushConfigured } from "@/lib/push";
import { usersWithPush } from "@/lib/db/notifications";

/**
 * The two loops that make notifications happen, hosted in the app process.
 *
 * Single container on a single VM, so a plain interval is honest: there is no
 * second instance to race with, and a cron sidecar would buy coordination
 * nobody needs while adding a thing that can be down separately. If this ever
 * runs more than one replica, the fix is to move these two calls behind a
 * lock or into a job that runs once — the functions themselves are already
 * idempotent, which is the part that would otherwise be hard.
 *
 * Guarded on globalThis because Next's dev server re-runs instrumentation on
 * reload, and two intervals would double every notification.
 */
const DELIVER_MS = 60_000;
const MATERIALIZE_MS = 5 * 60_000;

declare global {
  // eslint-disable-next-line no-var
  var __pummaNotifyTimers: { deliver: NodeJS.Timeout; plan: NodeJS.Timeout } | undefined;
}

export function startNotificationLoops(): void {
  if (globalThis.__pummaNotifyTimers) return;

  const deliver = setInterval(() => {
    void (async () => {
      try {
        const due = await collectDue();
        if (!due.length || !pushConfigured()) return;
        for (const n of due) await pushToUser(n.userId, n);
      } catch {
        // A failed tick is one late notification, not a reason to take the
        // interval down — the next one picks up whatever is still due.
      }
    })();
  }, DELIVER_MS);

  const plan = setInterval(() => {
    void (async () => {
      try {
        // Only users who could actually be reached. Materializing for an
        // account nobody has subscribed on is work whose output nothing
        // reads — their notifications get built when they open the app.
        for (const userId of await usersWithPush()) {
          await materializeFor(userId);
        }
      } catch {
        /* next pass */
      }
    })();
  }, MATERIALIZE_MS);

  // Node keeps the process alive for pending timers; these should never be
  // the reason a container refuses to exit.
  deliver.unref?.();
  plan.unref?.();
  globalThis.__pummaNotifyTimers = { deliver, plan };
}
