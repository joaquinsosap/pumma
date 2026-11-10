import "server-only";

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { getAccessLevel } from "@/lib/billing/access";

/**
 * Who is asking a route handler, or the answer to send when nobody may.
 *
 * Pages and actions use `requireUserId`, which answers with a redirect. A
 * redirect means nothing to a fetch, so routes check the same two things by
 * hand: a session, and (where billing is on) an account with access.
 */
export async function apiUserId(): Promise<
  { ok: true; userId: string } | { ok: false; response: NextResponse }
> {
  const user = await getSessionUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not signed in" }, { status: 401 }),
    };
  }
  if ((await getAccessLevel(user.id)) === "none") {
    return {
      ok: false,
      response: NextResponse.json({ error: "No access" }, { status: 403 }),
    };
  }
  return { ok: true, userId: user.id };
}
