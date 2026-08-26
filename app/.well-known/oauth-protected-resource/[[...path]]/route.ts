/**
 * RFC 9728 protected resource metadata.
 *
 * Catch-all so both the bare path and the path-suffixed form
 * (/.well-known/oauth-protected-resource/api/mcp) are answered; our own 401
 * challenge points at the latter, because the resource identifier has a path.
 *
 * Forwarded unchanged: the MCP plugin matches this on the raw pathname.
 */
import { serveDiscovery } from "@/lib/mcp/discovery";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return serveDiscovery(request);
}

/** Discovery clients probe with HEAD before they fetch. */
export async function HEAD(request: Request): Promise<Response> {
  return serveDiscovery(request);
}
