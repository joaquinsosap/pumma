/**
 * Same rewrite as the authorize route next door, on the way back.
 *
 * The authorization code is stored against the redirect URI the provider saw,
 * which is the normalised one. The client then presents the URI IT used, which
 * is still the localhost spelling, and the exchange would fail on a mismatch
 * that the client has no way to understand. Normalising both sides keeps them
 * consistent.
 */
import { getAuth } from "@/lib/auth";
import { normalizeLoopbackRedirect } from "@/lib/mcp/loopback-redirect";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return getAuth().handler(request);
  }

  const body = await request.text();
  const form = new URLSearchParams(body);
  const redirectUri = form.get("redirect_uri");
  if (!redirectUri) {
    return getAuth().handler(new Request(request.url, { ...requestInit(request), body }));
  }

  const normalized = normalizeLoopbackRedirect(redirectUri);
  if (normalized === redirectUri) {
    return getAuth().handler(new Request(request.url, { ...requestInit(request), body }));
  }
  form.set("redirect_uri", normalized);
  return getAuth().handler(
    new Request(request.url, { ...requestInit(request), body: form.toString() }),
  );
}

/** The parts of the original request a rebuilt one has to carry. */
function requestInit(request: Request): RequestInit {
  return {
    method: request.method,
    headers: request.headers,
    // Node needs this whenever a body is present on a rebuilt Request.
    duplex: "half",
  } as RequestInit;
}
