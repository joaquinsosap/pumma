"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/session";
import { getSubscriptionByUserId } from "@/lib/db/subscriptions";
import { deleteAllUserData } from "@/lib/db/account";
import { getUser } from "@/lib/db/users";
import type { ActionResult } from "@/lib/types";

/**
 * Statuses where money is still moving, or could start again.
 *
 * We cannot cancel at the payment provider from here — the app only ever links
 * out to their manage page — so deleting an account in any of these states
 * would leave someone paying for something that no longer exists. That is the
 * one failure mode worth refusing outright, so deletion waits until the
 * provider tells us billing has actually stopped.
 *
 * past_due counts: the provider is still retrying the card. paused counts too,
 * because a pause is designed to resume.
 */
const BILLING_LIVE = ["active", "trialing", "past_due", "paused"];

export type DeleteAccountBlock = {
  reason: "subscription";
  status: string;
};

const deleteAccountSchema = z.object({
  /** The account's own email, typed out. Anything less is too easy to click. */
  confirmation: z.string().min(1).max(320),
});

export async function deleteAccountAction(
  input: z.infer<typeof deleteAccountSchema>,
): Promise<ActionResult<{ deleted: true }>> {
  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  // Not requireUserId: that bounces lapsed accounts to /billing, and someone
  // who stopped paying is exactly who might want to close the account.
  const session = await getSessionUser();
  if (!session) return { ok: false, error: "Not signed in" };

  const profile = await getUser(session.id);
  const email = (session.email ?? profile?.email ?? "").trim().toLowerCase();
  const typed = parsed.data.confirmation.trim().toLowerCase();

  // With no email on file (memory mode) fall back to a fixed word, so local
  // dev still exercises the same path.
  const expected = email || "delete my account";
  if (typed !== expected) {
    return { ok: false, error: `Type ${expected} exactly to confirm.` };
  }

  const subscription = await getSubscriptionByUserId(session.id);
  if (subscription && BILLING_LIVE.includes(subscription.status)) {
    return {
      ok: false,
      error:
        "Cancel your subscription first, because we can't cancel it for you, and deleting now would leave you being charged for an account that no longer exists.",
    };
  }

  await deleteAllUserData(session.id);

  // Drop the cookie too. The session rows are already gone, so this is just
  // tidiness — but leaving a dead cookie behind makes the next page load look
  // like a crash rather than a sign-out.
  if (process.env.DATA_SOURCE === "mongodb") {
    try {
      const { getAuth } = await import("@/lib/auth");
      await getAuth().api.signOut({ headers: await headers() });
    } catch {
      // The user record is gone; a failure here changes nothing.
    }
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { deleted: true } };
}

/**
 * Whether deletion is currently blocked, so the UI can say so before the user
 * types their email rather than after.
 */
export async function accountDeletionBlock(): Promise<DeleteAccountBlock | null> {
  const session = await getSessionUser();
  if (!session) return null;
  const subscription = await getSubscriptionByUserId(session.id);
  if (subscription && BILLING_LIVE.includes(subscription.status)) {
    return { reason: "subscription", status: subscription.status };
  }
  return null;
}
