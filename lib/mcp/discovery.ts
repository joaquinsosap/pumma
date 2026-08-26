/**
 * Serving OAuth discovery documents from the domain root.
 *
 * Better Auth mounts every endpoint under its base path, so its metadata lives
 * at /api/auth/.well-known/*. Discovery does not work that way: a client that
 * has just been handed a 401 knows one thing, the URL in the WWW-Authenticate
 * header, and that URL is rooted at the host.
 *
 * There are two shapes to answer, and missing either one strands a client:
 *
 *   /.well-known/oauth-protected-resource            the bare form
 *   /.well-known/oauth-protected-resource/api/mcp    RFC 9728's path-suffixed
 *                                                    form, which is what our
 *                                                    own challenge points at
 *                                                    because the resource has
 *                                                    a path
 *
 * Hence the catch-all segments: the routes accept the suffix rather than only
 * the bare path. The first version of this served only the bare form, and the
 * 401 pointed at a 404.
 */
import { getAuth } from "@/lib/auth";
import { mcpAvailable } from "@/lib/mcp/config";

/**
 * Hand the request to Better Auth, optionally under a different path.
 *
 * The protected-resource document is matched by the MCP plugin against the raw
 * pathname, so it is forwarded untouched. The authorization-server and OIDC
 * documents are ordinary endpoints that only answer beneath the base path, so
 * for those the URL is rewritten to where they actually live. Either way the
 * document is produced by the library, never rebuilt here: a hand-written copy
 * would be a second, silently diverging source for the issuer and the scopes.
 */
export async function serveDiscovery(
  request: Request,
  rewriteTo?: string,
): Promise<Response> {
  if (!mcpAvailable()) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const target = rewriteTo
    ? new Request(new URL(rewriteTo, request.url), request)
    : request;
  const res = await getAuth().handler(target);

  // Discovery documents are public and read by clients on other origins
  // before any token exists. Without this a browser-based client cannot read
  // what it is being told to fetch.
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}
