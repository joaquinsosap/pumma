import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUserId } from "@/lib/auth/api-user";
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
 * Nothing is stored and nothing is changed.
 */
export async function POST(req: Request) {
  const who = await apiUserId(req);
  if (!who.ok) return who.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  return NextResponse.json(await readTicket(who.userId, parsed.data.url), {
    headers: { "Cache-Control": "no-store, private" },
  });
}
