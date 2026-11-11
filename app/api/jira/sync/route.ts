import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUserId } from "@/lib/auth/api-user";
import { syncProjectStatuses } from "@/lib/jira/sync-server";
import { entityId } from "@/lib/validation";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({ projectId: entityId, byHand: z.boolean().optional() })
  .strict();

/**
 * Read where one project's tickets stand in Jira and move its tasks to match.
 *
 * A route rather than a server action, like every ask of Jira: Next runs
 * actions one at a time, and a slow Jira would hold every save behind it.
 * How often Jira is really asked is decided on the server (lib/jira/sync-server),
 * so calling this often costs Jira nothing.
 */
export async function POST(req: Request) {
  const who = await apiUserId(req);
  if (!who.ok) return who.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const result = await syncProjectStatuses(who.userId, parsed.data.projectId, {
    byHand: parsed.data.byHand ?? false,
  });
  if (result.state === "ok" && result.moved > 0) revalidatePath("/", "layout");
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store, private" },
  });
}
