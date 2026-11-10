import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUserId } from "@/lib/auth/api-user";
import { pullSourceSchema } from "@/lib/jira/pull-input";
import { previewPull } from "@/lib/jira/pull-server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ source: pullSourceSchema }).strict();

/**
 * What a pull from Jira would bring in. Reads Jira, makes nothing.
 *
 * A route, not a server action, for the reason the ticket route gives: actions
 * run one at a time, and this waits on somebody else's server.
 */
export async function POST(req: Request) {
  const who = await apiUserId(req);
  if (!who.ok) return who.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  return NextResponse.json(await previewPull(who.userId, parsed.data.source), {
    headers: { "Cache-Control": "no-store, private" },
  });
}
