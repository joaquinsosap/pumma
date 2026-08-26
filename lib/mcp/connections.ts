/**
 * What is currently connected to this account, and how to cut it off.
 *
 * Revocation is the other half of consent. Granting access to something
 * holding every task, note and meeting you own is only reasonable if taking it
 * back is one click and does not require remembering which tool you approved
 * eight months ago.
 *
 * Reads the OAuth tables directly rather than going through the plugin's own
 * endpoints, because those answer for the session user via HTTP and this runs
 * inside a page render that already knows the user id. The tables are Better
 * Auth's, so the field names are its own; they are read here and nowhere else.
 */
import "server-only";
import { getDb } from "@/lib/mongodb";
import { userIdCandidates } from "@/lib/db/mongo/user-id";
import { MCP_SCOPE } from "@/lib/mcp/config";

export interface ConnectedClient {
  clientId: string;
  name: string;
  /** Scopes this account granted this client. */
  scopes: string[];
  /** Whether the grant includes deleting, worth calling out on its own. */
  canDelete: boolean;
  connectedAt: string | null;
}

/** Everything this account has approved, newest first. */
export async function listConnectedClients(
  userId: string,
): Promise<ConnectedClient[]> {
  if (process.env.DATA_SOURCE !== "mongodb") return [];
  const db = await getDb();
  // Better Auth writes an ObjectId here, the app writes strings elsewhere.
  // Querying with the session's string id alone matched nothing, so the panel
  // reported no connected apps while the consents were sitting right there.
  const consents = await db
    .collection("oauthConsent")
    .find({ userId: { $in: userIdCandidates(userId) } })
    .sort({ createdAt: -1 })
    .toArray();
  if (!consents.length) return [];

  const ids = consents.map((c) => String(c.clientId));
  const clients = await db
    .collection("oauthClient")
    .find({ clientId: { $in: ids } })
    .toArray();
  const byId = new Map(clients.map((c) => [String(c.clientId), c]));

  return consents.map((c) => {
    const clientId = String(c.clientId);
    const scopes = Array.isArray(c.scopes) ? c.scopes.map(String) : [];
    return {
      clientId,
      // Falls back to the raw id rather than inventing a friendly name for a
      // client we cannot identify.
      name: String(byId.get(clientId)?.name ?? clientId),
      scopes,
      canDelete: scopes.includes(MCP_SCOPE.delete),
      connectedAt:
        c.createdAt instanceof Date
          ? c.createdAt.toISOString()
          : typeof c.createdAt === "string"
            ? c.createdAt
            : null,
    };
  });
}

/**
 * Disconnect one client.
 *
 * Removes the consent AND every token issued under it, in that order. Removing
 * the consent alone would stop the client asking for a new grant while leaving
 * a thirty-day refresh token in its hands, which is the opposite of what
 * "disconnect" means to the person pressing it.
 *
 * Access tokens are self-contained JWTs, so an already-issued one keeps
 * verifying until it expires. That window is an hour, and it is bounded on the
 * other side by the per-request policy check: switching MCP off in Settings
 * stops even a live token immediately.
 */
export async function revokeClient(
  userId: string,
  clientId: string,
): Promise<{ consents: number; tokens: number }> {
  if (process.env.DATA_SOURCE !== "mongodb") return { consents: 0, tokens: 0 };
  const db = await getDb();
  // Same id-shape trap as the listing above, and worse here: a delete that
  // matches nothing reports success, so revoking would have looked like it
  // worked while the client kept its refresh token.
  const owner = { userId: { $in: userIdCandidates(userId) }, clientId };
  const consents = await db.collection("oauthConsent").deleteMany(owner);

  let tokens = 0;
  for (const name of ["oauthAccessToken", "oauthRefreshToken"]) {
    const res = await db.collection(name).deleteMany(owner);
    tokens += res.deletedCount ?? 0;
  }
  return { consents: consents.deletedCount ?? 0, tokens };
}
