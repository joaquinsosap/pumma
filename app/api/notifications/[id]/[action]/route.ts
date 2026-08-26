import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getNotification, markNotification } from "@/lib/db/notifications";
import { getTask, updateTask } from "@/lib/db/tasks";

export const dynamic = "force-dynamic";

/** How far a snooze pushes something out. One useful default, no picker. */
const SNOOZE_MS = 10 * 60_000;

/**
 * The notification action buttons, as route handlers.
 *
 * Routes rather than server actions because the caller is a service worker,
 * and a worker cannot invoke a server action — it has no React runtime and no
 * action id. It can do a same-origin fetch, which carries the session cookie,
 * so the check below is a real one.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; action: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id, action } = await ctx.params;
  // Scoped to the session user, so holding somebody else's notification id
  // buys nothing.
  const notification = await getNotification(user.id, id);
  if (!notification) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (action === "snooze") {
    // Back to scheduled with a later moment. Reusing the row rather than
    // creating one keeps the tray honest: a snoozed reminder is the same
    // reminder, not a second one about the same meeting.
    await markNotification(user.id, id, {
      status: "scheduled",
      fireAt: new Date(Date.now() + SNOOZE_MS).toISOString(),
      sentAt: null,
    });
    return NextResponse.json({ ok: true, snoozedUntilMs: SNOOZE_MS });
  }

  if (action === "read") {
    await markNotification(user.id, id, {
      status: "read",
      readAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "done") {
    if (notification.kind !== "task" || !notification.entityId) {
      return NextResponse.json({ error: "Not a task" }, { status: 400 });
    }
    const task = await getTask(user.id, notification.entityId);
    if (!task) {
      return NextResponse.json({ error: "Task is gone" }, { status: 404 });
    }
    await updateTask(user.id, notification.entityId, {
      status: "done",
      completedAt: new Date().toISOString(),
    });
    await markNotification(user.id, id, {
      status: "read",
      readAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
