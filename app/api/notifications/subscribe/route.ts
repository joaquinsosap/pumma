import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { upsertPushSubscription } from "@/lib/db/notifications";
import { pushSubscriptionSchema } from "@/lib/schemas";
import { newId } from "@/lib/store/memory";
import { refreshNotifications } from "@/lib/notifications-server";

export const dynamic = "force-dynamic";

/** Exactly the shape PushSubscription.toJSON() produces, and nothing else. */
const bodySchema = z
  .object({
    endpoint: z.string().url().max(2048),
    keys: z.object({
      p256dh: z.string().max(300),
      auth: z.string().max(300),
    }),
    label: z.string().max(80).optional(),
  })
  .strict()
  .or(
    z
      .object({
        endpoint: z.string().url().max(2048),
        expirationTime: z.unknown().nullish(),
        keys: z.object({
          p256dh: z.string().max(300),
          auth: z.string().max(300),
        }),
        label: z.string().max(80).optional(),
      })
      .strip(),
  );

/**
 * Register this browser for push.
 *
 * A route rather than an action because the service worker calls it too, from
 * `pushsubscriptionchange`, when the push service rotates an endpoint behind
 * everybody's back.
 *
 * Registering also materializes: somebody who just switched notifications on
 * should not wait up to five minutes for the planner's next pass before their
 * next meeting has a reminder.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const now = new Date().toISOString();
  await upsertPushSubscription(
    pushSubscriptionSchema.parse({
      _id: newId(),
      userId: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      label: parsed.data.label || "This device",
      createdAt: now,
      lastSeenAt: now,
    }),
  );

  await refreshNotifications(user.id);
  return NextResponse.json({ ok: true });
}
