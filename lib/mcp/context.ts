/**
 * Turning a verified token into a caller we are willing to serve.
 *
 * requireMcpAuth has already checked the token's signature, issuer, audience
 * and expiry by the time anything here runs. That answers "is this token real
 * and was it minted for us". It does not answer "should we serve this person
 * right now", which is a different question with several ways to say no.
 *
 * requireUserId() cannot be reused for it. That function redirects to /login
 * or /billing, which is exactly right for a page and useless for JSON-RPC:
 * a 302 to an HTML login form is not something an MCP client can act on, and
 * it reads as a network oddity rather than a refusal.
 */
import "server-only";
import { getAccessLevel } from "@/lib/billing/access";
import { getSettings } from "@/lib/db/settings";
import { getUser } from "@/lib/db/users";
import { mcpAvailable } from "@/lib/mcp/config";
import { mcpEnabledFor } from "@/lib/mcp/policy";
import { reserveMcpRequest, mcpRateLimitPerMinute } from "@/lib/mcp/rate-limit";
import { normalizeTimezone } from "@/lib/timezone";
import type { Settings } from "@/lib/schemas";

/** Everything a tool handler is allowed to know about who is calling. */
export interface McpCaller {
  userId: string;
  clientId: string;
  /** Scope claim, already parsed. */
  scopes: Set<string>;
  settings: Settings;
  /**
   * The account's timezone.
   *
   * An MCP request carries no cookie, and PUMMA resolves the timezone
   * cookie-first for browser requests. Anything answering "today" or
   * "overdue" for a caller with no cookie has to read the stored setting, or
   * it silently answers in UTC. The notification planner hit this exact
   * problem, and would have reminded everyone in UTC.
   */
  timeZone: string;
}

/** A refusal with a machine-readable reason, so the route can pick a status. */
export class McpAccessError extends Error {
  constructor(
    message: string,
    readonly code:
      | "unavailable"
      | "no_subscription"
      | "not_enabled"
      | "rate_limited"
      | "no_user",
  ) {
    super(message);
    this.name = "McpAccessError";
  }
}

/**
 * Resolve the caller, or throw the reason we will not serve them.
 *
 * The order matters and is cheapest-first, but more importantly it is
 * least-informative-first: an unknown token should not be able to learn
 * whether an account is over its rate limit.
 */
export async function resolveMcpCaller(claims: {
  sub?: unknown;
  scope?: unknown;
  client_id?: unknown;
  azp?: unknown;
}): Promise<McpCaller> {
  if (!mcpAvailable()) {
    throw new McpAccessError(
      "This PUMMA instance does not serve MCP.",
      "unavailable",
    );
  }

  // The user id comes from the verified token and nothing else. Never from a
  // header, a parameter, or anything else the caller can set.
  const userId = typeof claims.sub === "string" ? claims.sub : "";
  if (!userId) {
    throw new McpAccessError("Token carries no subject.", "no_user");
  }

  // A token outlives the account it was minted for. Deleting an account does
  // not reach into every client holding a refresh token, so a token whose user
  // is gone has to be refused here rather than serving an empty workspace.
  const user = await getUser(userId);
  if (!user) {
    throw new McpAccessError("That account no longer exists.", "no_user");
  }

  // Deliberately re-checked per request rather than trusted from token issue
  // time. A subscription can lapse while a 30-day refresh token is still
  // perfectly valid, and the token is not the place that decides billing.
  if ((await getAccessLevel(userId)) === "none") {
    throw new McpAccessError(
      "This PUMMA account does not have an active subscription.",
      "no_subscription",
    );
  }

  const clientId =
    (typeof claims.client_id === "string" && claims.client_id) ||
    (typeof claims.azp === "string" && claims.azp) ||
    "unknown";

  // Paced before the on/off check, not after, so that a client hammering an
  // account with MCP switched off is slowed down too. Refusals are cheap, but
  // they are not free: each one costs the lookups above, and a client stuck in
  // a retry loop against a disabled account would otherwise run flat out.
  if (!(await reserveMcpRequest(userId, clientId))) {
    throw new McpAccessError(
      `Too many requests. This connection is limited to ${mcpRateLimitPerMinute()} per minute.`,
      "rate_limited",
    );
  }

  // No settings row means the account was never bootstrapped. Treated as off
  // rather than as defaults: an account in a state we do not understand is not
  // one to start serving its data over a network interface.
  const settings = await getSettings(userId);
  if (!settings || !mcpEnabledFor(settings)) {
    throw new McpAccessError(
      "MCP access is turned off for this account. Turn it on in PUMMA under Settings, Connections.",
      "not_enabled",
    );
  }

  const raw = typeof claims.scope === "string" ? claims.scope : "";
  return {
    userId,
    clientId,
    scopes: new Set(raw.split(" ").filter(Boolean)),
    settings,
    timeZone: normalizeTimezone(settings.timezone),
  };
}
