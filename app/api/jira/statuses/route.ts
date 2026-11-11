import { NextResponse } from "next/server";
import { apiUserId } from "@/lib/auth/api-user";
import { readJiraStatuses } from "@/lib/jira/statuses-server";

export const dynamic = "force-dynamic";

/**
 * List the statuses of the Jira projects his tickets sit in, for the tables
 * in Settings. Only when he presses the button, at most once a minute.
 */
export async function POST(req: Request) {
  const who = await apiUserId(req);
  if (!who.ok) return who.response;
  const result = await readJiraStatuses(who.userId);
  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store, private" },
  });
}
