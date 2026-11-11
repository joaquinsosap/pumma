import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiUserId } from "@/lib/auth/api-user";
import { sendTaskToJira } from "@/lib/jira/move-server";
import { entityId } from "@/lib/validation";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ taskId: entityId }).strict();

/**
 * Send the column a task is in to its ticket in Jira, as Settings says that
 * column sends. Called after a move he made, or by Send to Jira on the task.
 *
 * A route rather than a server action, like every ask of Jira: Next runs
 * actions one at a time, and a slow Jira would hold every save behind it.
 */
export async function POST(req: Request) {
  const who = await apiUserId(req);
  if (!who.ok) return who.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const result = await sendTaskToJira(who.userId, parsed.data.taskId);
  // What Jira said is kept on the task, and the mark on its ticket reads it.
  if (result.state === "sent" || result.state === "already" || result.state === "refused") {
    revalidatePath("/", "layout");
  }
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store, private" },
  });
}
