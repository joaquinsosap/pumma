/**
 * OpenID Connect discovery, at the domain root.
 *
 * Same rewrite as the authorization-server document next door. Present because
 * some clients look here first and treat its absence as "this is not an OIDC
 * provider" rather than falling back.
 */
import { serveDiscovery } from "@/lib/mcp/discovery";

export const dynamic = "force-dynamic";

const TARGET = "/api/auth/.well-known/openid-configuration";

export async function GET(request: Request): Promise<Response> {
  return serveDiscovery(request, TARGET);
}

export async function HEAD(request: Request): Promise<Response> {
  return serveDiscovery(request, TARGET);
}
