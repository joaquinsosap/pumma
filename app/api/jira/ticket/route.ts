import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { getAccessLevel } from "@/lib/billing/access";
import { readTicket } from "@/lib/jira/connection-server";
import { TICKET_URL_MAX } from "@/lib/ticket-link";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({ url: z.string().min(1).max(TICKET_URL_MAX) })
  .strict();

/**
 * Where a task's linked ticket stands in Jira right now.
 *
 * A route rather than a server action because Next runs actions one at a time:
 * a Jira that takes ten seconds to answer, or never does, would hold every
 * save typed meanwhile in the queue behind it. A plain request waits alone.
 *
 * POST with the link in the body, not the address: a ticket's link is stored
 * encrypted, and a query string would write it into the access log in clear.
 *
 * Nothing is stored and nothing is changed. The paywall is checked by hand
 * because `requireUserId` answers with a redirect, which means nothing here.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if ((await getAccessLevel(user.id)) === "none") {
    return NextResponse.json({ error: "No access" }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  return NextResponse.json(await readTicket(user.id, parsed.data.url), {
    headers: { "Cache-Control": "no-store, private" },
  });
}
