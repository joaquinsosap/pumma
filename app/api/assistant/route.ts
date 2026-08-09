// The assistant's run endpoint. A route handler, not a server action, on
// purpose: Next serializes server actions per client and holds navigations
// behind the one in flight, so a 10-second AI call froze the whole app —
// clicking anywhere just queued. A fetch to this route leaves the router
// free; you land on /assistant instantly and watch it think.
import { NextResponse } from "next/server";
// Plain "zod", matching lib/validation — mixing the /v4 entrypoint with a
// schema built on the default one breaks inference on the composed object.
import { z } from "zod";
import { getSessionUserId } from "@/lib/auth/session";
import { getAccessLevel } from "@/lib/billing/access";
import { AI_QUOTA_MESSAGE, reserveAiCall } from "@/lib/ai/quota";
import { assist } from "@/lib/ai/assist";
import { aiInput } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  text: aiInput,
  mode: z.enum(["auto", "answer", "changeset"]).default("auto"),
});

export async function POST(req: Request) {
  // Server actions get an origin check from the framework; a cookie-carrying
  // route handler has to do its own. Same-origin browsers always send Origin
  // on POST; a mismatch is a cross-site request and gets nothing.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json(
      { ok: false, error: "Bad origin." },
      { status: 403 },
    );
  }

  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Please sign in." },
      { status: 401 },
    );
  }
  if ((await getAccessLevel(userId)) === "none") {
    return NextResponse.json(
      { ok: false, error: "Your subscription has lapsed." },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Say what you want to know or build (3 to 2000 characters).",
      },
      { status: 400 },
    );
  }

  if (!(await reserveAiCall(userId))) {
    return NextResponse.json(
      { ok: false, error: AI_QUOTA_MESSAGE },
      { status: 429 },
    );
  }

  try {
    const data = await assist(userId, parsed.data.text, parsed.data.mode);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "The assistant call failed.",
      },
      { status: 502 },
    );
  }
}
