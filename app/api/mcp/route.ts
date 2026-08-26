/**
 * The MCP endpoint.
 *
 * Layering, outermost first:
 *
 *   requireMcpAuth   verifies the bearer token against our own JWKS: signature,
 *                    issuer, audience, expiry, and DPoP when the token is
 *                    sender-bound. A token minted for a different resource is
 *                    refused here, which is the spec's "MUST NOT accept tokens
 *                    that were not issued for this server".
 *   resolveMcpCaller decides whether we will serve this person right now:
 *                    account still exists, subscription live, MCP switched on,
 *                    inside the rate limit.
 *   runTool          per call, checks scope then account policy, records the
 *                    audit line, and shapes errors.
 *
 * A fresh McpServer is built per request. That is the SDK's model for the
 * stateless 2026-07-28 protocol and it suits us: the instance closes over one
 * verified caller, so a tool physically cannot read another user's data by
 * forgetting to pass a userId.
 *
 * Legacy 2025 clients are served (`legacy` defaults to 'stateless'). The 2026
 * revision is a month old and Claude connectors, Claude Code and most clients
 * in the wild still speak the older protocol. Rejecting them would be
 * standards-pedantry that ships a feature nobody can connect to.
 */
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { requireMcpAuth } from "@better-auth/mcp";
import { getAuth } from "@/lib/auth";
import {
  mcpResourceUrl,
  mcpAvailable,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
} from "@/lib/mcp/config";
import { resolveMcpCaller, McpAccessError, type McpCaller } from "@/lib/mcp/context";
import { annotationsFor, runTool } from "@/lib/mcp/registry";
import { toolInput } from "@/lib/mcp/schema";
import { MCP_TOOLS } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";
// Tools do real database work; the default is fine but be explicit, because a
// silent platform timeout looks like a hung client.
export const maxDuration = 60;

function buildServer(caller: McpCaller): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      // The 2026 revision lets a client cache list results. Our tool list is
      // built from a static catalogue and does not vary by user or by
      // settings, so re-sending it on every reconnect is pure overhead.
      //
      // `private` rather than `public` even though the list is currently the
      // same for everyone: it costs nothing, and it means that if the
      // catalogue ever does start varying per account, a shared cache is not
      // already holding one user's version for another. Five minutes is short
      // enough that adding a tool shows up quickly.
      cacheHints: {
        "tools/list": { ttlMs: 5 * 60 * 1000, cacheScope: "private" },
      },
    },
  );

  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: toolInput(tool.inputSchema),
        annotations: annotationsFor(tool.opClass),
      },
      // The cast is the seam between the registry's per-tool generic and the
      // SDK's own callback type. Each tool's own schema still types its
      // handler; this only erases the union across differently-shaped tools.
      runTool(tool, caller) as never,
    );
  }
  return server;
}

/** JSON-RPC shaped refusal, so a client reports a reason rather than a parse error. */
function rpcError(status: number, code: number, message: string): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status },
  );
}

async function handle(request: Request, claims: Record<string, unknown>) {
  let caller: McpCaller;
  try {
    caller = await resolveMcpCaller(claims);
  } catch (err) {
    if (err instanceof McpAccessError) {
      // 403 for "we know who you are and the answer is no", 429 for pace.
      // Never 401: the token is valid, and telling a client to re-authenticate
      // would send it round the whole OAuth flow to arrive at the same answer.
      const status = err.code === "rate_limited" ? 429 : 403;
      return rpcError(status, -32001, err.message);
    }
    throw err;
  }

  const handler = createMcpHandler(() => buildServer(caller));
  return handler.fetch(request);
}

/**
 * Built on first use, not at module load.
 *
 * `requireMcpAuth` takes the auth instance eagerly, and `getAuth()` throws
 * without MONGODB_URI. At module scope that turns "this instance does not
 * serve MCP" into an import-time crash in memory mode, and into a build-time
 * crash in Docker, where the image is built against a placeholder URI.
 */
let cached: ((req: Request) => Promise<Response>) | null = null;
function protectedHandler() {
  cached ??= requireMcpAuth(
    getAuth(),
    (request, claims) => handle(request, claims as Record<string, unknown>),
    { resource: mcpResourceUrl() },
  );
  return cached;
}

export async function POST(request: Request): Promise<Response> {
  if (!mcpAvailable()) {
    return rpcError(404, -32601, "This PUMMA instance does not serve MCP.");
  }
  return protectedHandler()(request);
}

/**
 * GET and DELETE are 2025-era session operations. The stateless protocol has
 * no sessions to resume or tear down, so they are answered rather than left to
 * fall through to Next's 405 page, which returns HTML to a JSON-RPC client.
 */
export async function GET(): Promise<Response> {
  return rpcError(405, -32601, "MCP requests use POST.");
}
