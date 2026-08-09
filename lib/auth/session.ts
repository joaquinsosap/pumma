// The single seam every server action / data loader uses to learn who's asking.
// mongodb mode → real Better Auth session (redirects to /login when absent).
// memory mode  → the demo user (keeps local demo + tests working without auth).
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUserId as demoUserId } from "@/lib/store/memory";
import { getAccessLevel, type AccessLevel } from "@/lib/billing/access";

const AUTH_ACTIVE = () => process.env.DATA_SOURCE === "mongodb";

/** Whether real sessions exist (mongodb mode). Memory mode has no auth to sign
 *  out of, so the UI hides account/sign-out controls. */
export function isAuthEnabled(): boolean {
  return AUTH_ACTIVE();
}

/** Session user id, or null when unauthenticated. Deduped per request. */
export const getSessionUserId = cache(async (): Promise<string | null> => {
  const user = await getSessionUser();
  return user?.id ?? null;
});

/** Session user id + email, or null. Deduped per request. */
export const getSessionUser = cache(
  async (): Promise<{ id: string; email: string | null } | null> => {
    if (!AUTH_ACTIVE()) return { id: demoUserId(), email: null };
    const { getAuth } = await import("@/lib/auth");
    const session = await getAuth().api.getSession({
      headers: await headers(),
    });
    return session
      ? { id: session.user.id, email: session.user.email ?? null }
      : null;
  },
);

/** Access level, deduped per request (layout + page + actions share one read). */
const cachedAccessLevel = cache(
  async (userId: string): Promise<AccessLevel> => getAccessLevel(userId),
);

/**
 * Session user id or redirect. Use at the top of pages/actions.
 *
 * This is also the paywall: with BILLING_ENABLED=1, accounts without access
 * (no subscription row, not an owner, not a live demo) are redirected to
 * /billing — including for server actions, so an unpaid account can't drive
 * the app through direct action calls either. With billing off (self-hosted
 * default) the check short-circuits to "owner" and never touches the DB.
 */
export async function requireUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/login");
  if ((await cachedAccessLevel(userId)) === "none") redirect("/billing");
  return userId;
}

/** Gate + level in one call (used by the app shell for demo banners etc.). */
export async function requireAccess(): Promise<AccessLevel> {
  const userId = await requireUserId();
  return cachedAccessLevel(userId);
}
