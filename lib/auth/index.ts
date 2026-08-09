// Server-only Better Auth instance backed by the same MongoDB database.
// Only active when DATA_SOURCE=mongodb — the memory demo bypasses auth entirely
// (see lib/auth/session.ts).
import "server-only";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { MongoClient } from "mongodb";
import { bootstrapNewUser } from "@/lib/auth/bootstrap";

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
    // Lets server actions (demo provisioning) set the session cookie. Must be last.
    plugins: [nextCookies()],
  });
}

type AuthInstance = ReturnType<typeof buildAuth>;

const globalForAuth = globalThis as unknown as { __pummaAuth?: AuthInstance };

/** Lazily constructed so memory-mode dev never needs Mongo/auth env. */
export function getAuth(): AuthInstance {
  if (!globalForAuth.__pummaAuth) globalForAuth.__pummaAuth = buildAuth();
  return globalForAuth.__pummaAuth;
}
