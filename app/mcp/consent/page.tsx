/**
 * The consent screen: the one moment the person decides what a tool may do
 * with everything they have ever written down.
 *
 * The MCP security guidance is unusually specific about this page, because it
 * is the step attacks aim at. It must name the client, show the redirect the
 * code will be sent to, list the actual scopes, resist framing, and never be
 * reachable without a session. Each of those is here, and the reasons are
 * noted where they are not obvious.
 *
 * The whole signed OAuth query is handed back to Better Auth on accept rather
 * than reassembled from parts. It carries a signature over the parameters, so
 * passing it through unchanged is what makes it impossible for this page to
 * approve a request different from the one it displayed.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSessionUser } from "@/lib/auth/session";
import { getUser } from "@/lib/db/users";
import { mcpAvailable, SCOPE_LABELS } from "@/lib/mcp/config";
import { rebuildQuery } from "@/lib/mcp/query";
import { ConsentForm } from "@/components/mcp/ConsentForm";

export const metadata: Metadata = { title: "Connect an app · P.U.M.M.A" };
export const dynamic = "force-dynamic";

/** Hostname only, so a long URL cannot push the identity off the screen. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * A redirect to loopback proves nothing about which local process is
 * listening, so any local program can claim to be a well-known client. The
 * spec asks that this be surfaced rather than smoothed over.
 */
function isLoopback(url: string): boolean {
  const host = hostOf(url) ?? "";
  const name = host.split(":")[0];
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]" || name === "::1";
}

export default async function McpConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!mcpAvailable()) redirect("/");

  const params = await searchParams;
  const one = (k: string): string =>
    typeof params[k] === "string" ? (params[k] as string) : "";

  const queryString = () => rebuildQuery(params);

  const session = await getSessionUser();
  // Better Auth sends people to loginPage before here, so this is a backstop
  // rather than the normal path. Bounce back so the flow resumes after login.
  if (!session) {
    redirect(
      `/login?redirect=${encodeURIComponent(`/mcp/consent?${queryString()}`)}`,
    );
  }

  const clientId = one("client_id");
  const redirectUri = one("redirect_uri");
  const scopes = one("scope").split(" ").filter(Boolean);

  const oauthQuery = queryString();

  // A demo account is a throwaway that deletes itself within hours. Letting it
  // mint a thirty-day refresh token would outlive the account that granted it.
  const appUser = await getUser(session.id);
  const isDemo = Boolean((appUser as { isDemo?: boolean } | null)?.isDemo);

  // Falls back to the raw client id, which is ugly on purpose: an unidentified
  // client should look unidentified rather than borrow a friendly name.
  let clientName = clientId;
  let clientUri: string | null = null;
  try {
    const { getAuth } = await import("@/lib/auth");
    // Snake_case, because this endpoint answers in the OAuth wire format
    // rather than the adapter's own field names. The stored row calls it
    // `name`; reading that here produced a consent screen headed by a random
    // 32-character id, which is exactly the identity signal this page exists
    // to provide. Both are read, wire format first.
    const client = (await getAuth().api.getOAuthClientPublic({
      query: { client_id: clientId },
      headers: await headers(),
    })) as {
      client_name?: string;
      name?: string;
      client_uri?: string;
      clientUri?: string;
    } | null;
    clientName = client?.client_name ?? client?.name ?? clientId;
    clientUri = client?.client_uri ?? client?.clientUri ?? null;
  } catch {
    // An unresolvable client is not a reason to fail closed with a stack
    // trace. Fall through showing the raw id, which is honest about how little
    // we know, and let the person judge it.
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10 text-ink">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-[12px] bg-ink font-mono text-lg font-bold text-background">
            P
          </span>
          <p className="font-mono text-[10px] uppercase tracking-widest text-faint">
            Connect an app
          </p>
        </div>

        <ConsentForm
          clientId={clientId}
          clientName={clientName}
          clientHost={clientUri ? hostOf(clientUri) : null}
          redirectUri={redirectUri}
          redirectHost={hostOf(redirectUri)}
          loopback={isLoopback(redirectUri)}
          scopes={scopes.map((s) => ({
            id: s,
            title: SCOPE_LABELS[s]?.title ?? s,
            detail: SCOPE_LABELS[s]?.detail ?? "",
          }))}
          oauthQuery={oauthQuery}
          isDemo={isDemo}
          userEmail={session.email}
        />
      </div>
    </div>
  );
}
