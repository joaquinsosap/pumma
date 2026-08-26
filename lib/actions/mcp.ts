"use server";

// Disconnecting a client, from the Settings panel.
import { revalidatePath } from "next/cache";
import { requireUserId } from "@/lib/auth/session";
import { revokeClient } from "@/lib/mcp/connections";
import type { ActionResult } from "@/lib/types";

export async function revokeMcpClientAction(
  clientId: string,
): Promise<ActionResult> {
  if (typeof clientId !== "string" || !clientId || clientId.length > 200) {
    return { ok: false, error: "Invalid client" };
  }
  const userId = await requireUserId();
  // Scoped to the session user inside revokeClient, so a crafted clientId can
  // only ever remove this account's own grant.
  await revokeClient(userId, clientId);
  revalidatePath("/", "layout");
  return { ok: true };
}
