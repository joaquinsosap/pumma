/**
 * RFC 8414 authorization server metadata, at the domain root.
 *
 * Rewritten to the base path, unlike its protected-resource neighbour: this
 * one is an ordinary Better Auth endpoint rather than a raw-path hook, so it
 * only answers beneath /api/auth.
 *
 * Catch-all because RFC 8414 puts an issuer's path after the well-known
 * segment, and our issuer is /api/auth.
 */
import { serveDiscovery } from "@/lib/mcp/discovery";

export const dynamic = "force-dynamic";

const TARGET = "/api/auth/.well-known/oauth-authorization-server";

export async function GET(request: Request): Promise<Response> {
  return serveDiscovery(request, TARGET);
}

export async function HEAD(request: Request): Promise<Response> {
  return serveDiscovery(request, TARGET);
}
