// Server-only Better Auth instance backed by the same MongoDB database.
// Only active when DATA_SOURCE=mongodb — the memory demo bypasses auth entirely
// (see lib/auth/session.ts).
import "server-only";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { MongoClient } from "mongodb";
import { bootstrapNewUser } from "@/lib/auth/bootstrap";
import { mcpResourceUrl, MCP_SCOPES } from "@/lib/mcp/config";

function buildAuth() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required for auth (DATA_SOURCE=mongodb).");
  }
  // Dedicated light client for auth traffic; the app pool lives in lib/mongodb.
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    maxPoolSize: 5,
  });
  const db = client.db(process.env.MONGODB_DB ?? "pumma");

  return betterAuth({
    database: mongodbAdapter(db),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
    },
    session: {
      cookieCache: { enabled: true, maxAge: 60 }, // cut a DB hit per request
    },
    // Behind the reverse proxy every request carries Traefik's IP — trust its
    // forwarded header so the limits below are per-client, not global.
    advanced: {
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    // Per-IP limits on the auth endpoints (in-memory store — one container).
    // Sign-up is the abuse magnet: accounts are free to create, so keep it
    // slow; sign-in stays tight enough to blunt credential stuffing.
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        "/sign-up/email": { window: 3600, max: 5 },
        "/sign-in/email": { window: 60, max: 10 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // First-login bootstrap: app user doc, settings, default tag.
            await bootstrapNewUser({
              id: user.id,
              name: user.name,
              email: user.email,
            });
          },
        },
      },
    },
    plugins: [
      // Signs the ID and access tokens the MCP server verifies, and serves
      // /jwks. Required by mcp(); without it there is no stable signing key.
      jwt(),
      // PUMMA as an OAuth 2.1 authorization server, configured for MCP: it
      // binds every issued token to the resource identifier below, so a token
      // minted for someone else's server can never be spent here.
      mcp({
        loginPage: "/login",
        consentPage: "/mcp/consent",
        resource: mcpResourceUrl(),
        scopes: MCP_SCOPES,
        // An hour is short enough that revoking a connection takes effect
        // quickly, long enough not to churn refreshes all day.
        accessTokenExpiresIn: 60 * 60,
        refreshTokenExpiresIn: 60 * 60 * 24 * 30,
        // Dynamic Client Registration, open to unauthenticated callers.
        //
        // MCP 2026-07-28 deprecates DCR in favour of CIMD, which is configured
        // below and is the better mechanism. But deprecated is not gone: it
        // has a twelve-month offramp, and essentially every client shipping
        // today still registers this way. CIMD additionally cannot work from a
        // developer's machine at all, because a metadata document has to be
        // fetchable at a public HTTPS URL and localhost is rejected by design.
        // Turning DCR off would be standards-purity that ships an endpoint
        // nobody can connect to.
        //
        // Open registration is safe here in a way it would not be for an OAuth
        // proxy. Registering grants nothing: the client still has to send its
        // user through our login and our consent screen, consent is recorded
        // per client, and that screen shows the redirect URI the code would be
        // sent to. The confused-deputy attack this option is usually feared
        // for needs a static upstream client id and a third-party consent
        // cookie to skip past, and PUMMA has no upstream to be confused about.
        // What is left is junk rows in `oauthClient`, which is a housekeeping
        // problem rather than an authorization one.
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
      // Client ID Metadata Documents: the registration path MCP 2026-07-28
      // prefers over Dynamic Client Registration.
      //
      // fetchClientMetadataResource is the library's own Node transport, and
      // using it rather than plain fetch is not optional. This is the one
      // place the server fetches a URL chosen by an unauthenticated stranger,
      // which is precisely the SSRF hole the spec calls out: it must resolve
      // DNS once, reject special-use addresses, pin the resolved address for
      // the connection, and refuse redirects. Wrapping global fetch cannot
      // pin the address, so the check and the connection would resolve
      // separately and a hostile DNS answer could differ between them.
      cimd({
        fetchClientMetadataResource,
        metadataProfile: "mcp-2026-07-28",
      }),
      // Lets server actions (demo provisioning) set the session cookie. Must be last.
      nextCookies(),
    ],
  });
}

type AuthInstance = ReturnType<typeof buildAuth>;

const globalForAuth = globalThis as unknown as { __pummaAuth?: AuthInstance };

/** Lazily constructed so memory-mode dev never needs Mongo/auth env. */
export function getAuth(): AuthInstance {
  if (!globalForAuth.__pummaAuth) globalForAuth.__pummaAuth = buildAuth();
  return globalForAuth.__pummaAuth;
}
