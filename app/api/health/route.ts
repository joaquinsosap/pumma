import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Health endpoint for k8s probes / uptime checks.
 * - liveness: this handler responding at all means the process is up.
 * - readiness: `?ready=1` also pings the database (1s budget).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const checkReady = url.searchParams.get("ready") === "1";

  if (!checkReady || process.env.DATA_SOURCE !== "mongodb") {
    return NextResponse.json({ status: "ok" });
  }

  try {
    const { getDb } = await import("@/lib/mongodb");
    const db = await getDb();
    await Promise.race([
      db.command({ ping: 1 }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("db ping timeout")), 1_000),
      ),
    ]);
    return NextResponse.json({ status: "ok", db: "ok" });
  } catch {
    return NextResponse.json(
      { status: "degraded", db: "unreachable" },
      { status: 503 },
    );
  }
}
