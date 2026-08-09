import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { exportUserData } from "@/lib/db/account";

export const dynamic = "force-dynamic";

/** Fields that must never leave the server, whatever collection they sit in. */
const REDACTED_FIELDS = ["aiApiKeyEnc"];

function redact(rows: unknown[]): unknown[] {
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const copy = { ...(row as Record<string, unknown>) };
    for (const field of REDACTED_FIELDS) delete copy[field];
    return copy;
  });
}

/**
 * Everything this account owns, as one JSON file.
 *
 * A route handler rather than a server action because the point is a file
 * download, and actions can't set Content-Disposition.
 *
 * Deliberately not gated by requireUserId: that redirects unpaid accounts to
 * /billing, and someone whose subscription lapsed should still be able to take
 * their data with them. A valid session is the only thing being asked for.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const data = await exportUserData(user.id);
  const payload = {
    exportedAt: new Date().toISOString(),
    format: 1,
    account: { id: user.id, email: user.email },
    // The AI key is stored encrypted and stays server-side; it isn't yours to
    // restore from a file anyway, and a plaintext copy in Downloads is a
    // liability.
    note: "Your stored AI API key is deliberately excluded.",
    data: Object.fromEntries(
      Object.entries(data).map(([name, rows]) => [name, redact(rows)]),
    ),
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="pumma-export-${stamp}.json"`,
      "Cache-Control": "no-store, private",
    },
  });
}
