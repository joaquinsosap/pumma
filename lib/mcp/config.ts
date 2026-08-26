/**
 * Where the MCP server lives, and whether this instance serves it at all.
 *
 * Read at runtime, never at build time. `NEXT_PUBLIC_` inlining burned this
 * codebase once already: the VAPID public key was baked into the image at
 * build, the image is built in CI where the value does not exist, and push
 * reported itself unconfigured forever with nothing in any log to explain it.
 * The resource identifier here is load-bearing in the same way, because it is
 * the audience every access token is bound to: a wrong value does not fail
 * loudly, it just refuses every token.
 */

/** Falls back to localhost so a self-hosted dev instance needs no extra env. */
function baseUrl(): string {
  return process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
}

/**
 * The canonical protected resource identifier (RFC 8707 / RFC 9728).
 *
 * Must match on both sides: `mcp({ resource })` binds issued tokens to it and
 * publishes it in the protected resource metadata, and `requireMcpAuth` checks
 * it as the expected audience. They read the same function so they cannot
 * disagree.
 *
 * Must be HTTPS in production; HTTP is accepted only on loopback, which the
 * plugin itself enforces.
 */
export function mcpResourceUrl(): string {
  return `${baseUrl().replace(/\/+$/, "")}/api/mcp`;
}

/**
 * Operator kill switch, distinct from the per-user setting.
 *
 * Default on: a self-hosted install that upgrades should not silently lose a
 * feature it was using. `MCP_ENABLED=0` turns the endpoint off for everyone on
 * this instance regardless of what any account has chosen.
 */
export function mcpServingEnabled(): boolean {
  return process.env.MCP_ENABLED !== "0";
}

/** MCP needs real accounts, so it follows auth: mongodb mode only. */
export function mcpAvailable(): boolean {
  return process.env.DATA_SOURCE === "mongodb" && mcpServingEnabled();
}

/** Server identity reported in MCP responses. */
export const MCP_SERVER_NAME = "pumma";
export const MCP_SERVER_VERSION = "1.0.0";

/**
 * The scopes this server issues, smallest useful split rather than one
 * omnibus grant, so a stolen token is bounded by what it was granted and a
 * consent screen can say something specific.
 *
 * Read, write and delete are separate because they are separate decisions:
 * plenty of people want an assistant that can see everything and change
 * nothing.
 */
export const MCP_SCOPE = {
  read: "pumma:read",
  write: "pumma:write",
  delete: "pumma:delete",
} as const;

/** Advertised in metadata and offered on the consent screen. */
export const MCP_SCOPES: string[] = [
  "openid",
  "profile",
  "offline_access",
  MCP_SCOPE.read,
  MCP_SCOPE.write,
  MCP_SCOPE.delete,
];

/** Plain words for the consent screen. Never show a raw scope string. */
export const SCOPE_LABELS: Record<string, { title: string; detail: string }> = {
  openid: {
    title: "Confirm who you are",
    detail: "Your account id, so the app knows whose data to serve.",
  },
  profile: {
    title: "Your name",
    detail: "Shown so the tool can address you.",
  },
  offline_access: {
    title: "Stay connected",
    detail: "Keeps working without asking you to sign in again each time.",
  },
  [MCP_SCOPE.read]: {
    title: "Read your data",
    detail: "Tasks, projects, goals, habits, notes and your agenda.",
  },
  [MCP_SCOPE.write]: {
    title: "Create and edit",
    detail: "Add and change items. Cannot delete anything.",
  },
  [MCP_SCOPE.delete]: {
    title: "Delete",
    detail: "Permanently remove items. Off by default in your settings.",
  },
};
