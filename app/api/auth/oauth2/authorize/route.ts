/**
 * Shadows the Better Auth catch-all for this one path, to normalise a
 * localhost redirect URI before the provider matches it.
 *
 * See lib/mcp/loopback-redirect.ts for why. In short: native clients bind an
 * ephemeral callback port, RFC 8252 says the port must be ignored for loopback
 * redirects, and the provider does that only for IP literals, so
 * `http://localhost:56126/callback` never matches the registered
 * `http://localhost/callback` and every CLI client fails to connect.
 *
 * The token endpoint next door applies the same rewrite, because the value
 * recorded with the authorization code has to match the one presented when it
 * is exchanged.
 */
import { getAuth } from "@/lib/auth";
import { normalizeLoopbackRedirect } from "@/lib/mcp/loopback-redirect";

export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const redirectUri = url.searchParams.get("redirect_uri");
  if (redirectUri) {
    const normalized = normalizeLoopbackRedirect(redirectUri);
    if (normalized !== redirectUri) {
      url.searchParams.set("redirect_uri", normalized);
      // Rebuilt rather than mutated in place: Request URLs are immutable.
      return getAuth().handler(new Request(url, request));
    }
  }
  return getAuth().handler(request);
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
