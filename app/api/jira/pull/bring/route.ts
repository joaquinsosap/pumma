import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { apiUserId } from "@/lib/auth/api-user";
import { pullRunSchema } from "@/lib/jira/pull-input";
import { runPull } from "@/lib/jira/pull-server";

export const dynamic = "force-dynamic";

/**
 * Bring a pull in: make its project, its epic tags and its tasks.
 *
 * The body says only what to read, which level is the project, how the
 * selectors are set and which tickets were unticked. What gets made is worked
 * out on the server.
 */
export async function POST(req: Request) {
  const who = await apiUserId(req);
  if (!who.ok) return who.response;
  const parsed = pullRunSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const run = await runPull(who.userId, parsed.data);
  if (run.state === "ok") revalidatePath("/", "layout");
  return NextResponse.json(run, {
    headers: { "Cache-Control": "no-store, private" },
  });
}
