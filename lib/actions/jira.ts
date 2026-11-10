"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/types";
import { requireUserId } from "@/lib/auth/session";
import { encryptSecret } from "@/lib/crypto";
import { updateSettings } from "@/lib/db/settings";
import { jiraBaseFromUrl } from "@/lib/jira/address";
import { jiraMyself } from "@/lib/jira/client";
import { jiraConnection } from "@/lib/jira/connection-server";

const saveSchema = z.object({
  address: z.string().max(2048),
  // Blank keeps the token already saved, as long as the address still points at the same Jira.
  token: z.string().max(600).optional(),
});

/**
 * A personal access token is one long unbroken run of characters. This catches
 * a pasted sentence, not a revoked token. Long enough, too, that the four
 * characters kept readable say nothing useful about the rest.
 */
const plausibleToken = (t: string) => t.length >= 20 && !/\s/.test(t);

const UNREADABLE =
  "The saved Jira connection can no longer be read. Enter the address and the token again.";

/**
 * Save where the user's Jira lives and their personal token.
 *
 * Both are stored encrypted. The token is never sent back: only its last four
 * characters are kept readable, so the screen can show which one is saved.
 */
export async function saveJiraConnectionAction(
  input: z.infer<typeof saveSchema>,
): Promise<ActionResult<{ address: string; tokenLast4: string | null }>> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const address = jiraBaseFromUrl(parsed.data.address);
  if (!address) {
    return {
      ok: false,
      error:
        "That is not an address PUMMA can connect to. Paste any page of your Jira, starting with https://",
    };
  }
  // Atlassian's own cloud signs in another way (an email and an API token), so a token would only ever be refused there.
  if (new URL(address).hostname.endsWith(".atlassian.net")) {
    return {
      ok: false,
      error:
        "Atlassian's cloud Jira is not supported yet. This works with a Jira your company hosts (Data Center or Server).",
    };
  }
  const token = (parsed.data.token ?? "").trim();
  if (token && !plausibleToken(token)) {
    return { ok: false, error: "That does not look like a Jira token." };
  }

  const userId = await requireUserId();
  if (!token) {
    const saved = await jiraConnection(userId);
    if (saved.state === "none") {
      return { ok: false, error: "Paste your Jira personal access token." };
    }
    if (saved.state === "unreadable") return { ok: false, error: UNREADABLE };
    // A token is for one Jira. Kept across a change of host, the next request
    // would hand it to whoever answers there, and whoever typed the new
    // address need not be the person who pasted the token.
    if (new URL(saved.baseUrl).origin !== new URL(address).origin) {
      return {
        ok: false,
        error:
          "The saved token is for a different address. Paste the token for this Jira.",
      };
    }
  }

  const patch: {
    jiraBaseUrlEnc: string;
    jiraTokenEnc?: string;
    jiraTokenLast4?: string;
  } = { jiraBaseUrlEnc: encryptSecret(address) };
  if (token) {
    patch.jiraTokenEnc = encryptSecret(token);
    patch.jiraTokenLast4 = token.slice(-4);
  }
  const saved = await updateSettings(userId, patch);
  revalidatePath("/", "layout");
  return {
    ok: true,
    data: { address, tokenLast4: saved?.jiraTokenLast4 ?? null },
  };
}

/** Ask the saved Jira who the saved token belongs to. Proves, from the server, that both work. */
export async function testJiraConnectionAction(): Promise<
  ActionResult<{ name: string }>
> {
  const userId = await requireUserId();
  const creds = await jiraConnection(userId);
  if (creds.state === "unreadable") return { ok: false, error: UNREADABLE };
  if (creds.state === "none") {
    return { ok: false, error: "Save your Jira address and token first." };
  }
  const who = await jiraMyself(creds.baseUrl, creds.token);
  if (!who.ok) return { ok: false, error: who.error };
  return { ok: true, data: who.data };
}

/** Forget the connection. Tickets already linked keep their links: those are addresses, not credentials. */
export async function clearJiraConnectionAction(): Promise<ActionResult> {
  const userId = await requireUserId();
  await updateSettings(userId, {
    jiraBaseUrlEnc: null,
    jiraTokenEnc: null,
    jiraTokenLast4: null,
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
