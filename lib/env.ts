// Boot-time environment validation. Imported from instrumentation.ts so a
// misconfigured deployment fails fast at startup with a clear message instead
// of crashing mid-request. Extend the schema as new required vars appear
// (auth secrets, SMTP, …).
import * as z from "zod/v4";

const envSchema = z
  .object({
    DATA_SOURCE: z.enum(["memory", "mongodb"]).default("memory"),
    MONGODB_URI: z.string().optional(),
    MONGODB_DB: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    ASSISTANT_MODEL: z.string().optional(),
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    // Wraps every user's data key. Separate from BETTER_AUTH_SECRET on
    // purpose: they protect different things and should be rotatable
    // independently. See lib/crypto/master-key.ts.
    DATA_ENCRYPTION_KEY: z.string().optional(),
    // Web push. Optional: without them the app still notifies in-app, it just
    // cannot reach a closed browser. Rotating them invalidates every existing
    // subscription silently, so they belong in the password manager beside
    // DATA_ENCRYPTION_KEY.
    VAPID_PUBLIC_KEY: z.string().optional(),
    // The old spelling, still honoured so an existing install keeps working.
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
    VAPID_PRIVATE_KEY: z.string().optional(),
    VAPID_SUBJECT: z.string().optional(),
    DATA_ENCRYPTION_PROVIDER: z.enum(["env", "kms"]).optional(),
    BETTER_AUTH_URL: z.string().optional(),
    // Hosted-mode seam — optional; the access gate only arms with
    // BILLING_ENABLED=1, and self-hosted installs never set these.
    BILLING_ENABLED: z.enum(["0", "1"]).optional(),
    OWNER_EMAILS: z.string().optional(),
    // Where anonymous visitors at "/" are sent (a hosted marketing page).
    MARKETING_HOME: z.string().optional(),
    // Every public path the proxy routes to the marketing service, comma
    // separated. Only robots.txt reads it — see lib/seo.ts for why it is
    // separate from MARKETING_HOME.
    MARKETING_PATHS: z.string().optional(),
  })
  .check((ctx) => {
    if (ctx.value.DATA_SOURCE === "mongodb" && !ctx.value.MONGODB_URI) {
      ctx.issues.push({
        code: "custom",
        message: "MONGODB_URI is required when DATA_SOURCE=mongodb",
        input: ctx.value,
        path: ["MONGODB_URI"],
      });
    }
    if (ctx.value.DATA_SOURCE === "mongodb" && !ctx.value.DATA_ENCRYPTION_KEY) {
      ctx.issues.push({
        code: "custom",
        message:
          "DATA_ENCRYPTION_KEY is required when DATA_SOURCE=mongodb " +
          "(generate: openssl rand -base64 32). Back it up before first use, " +
          "losing it means losing every user's content.",
        input: ctx.value,
        path: ["DATA_ENCRYPTION_KEY"],
      });
    }
    if (
      ctx.value.DATA_ENCRYPTION_KEY &&
      Buffer.from(ctx.value.DATA_ENCRYPTION_KEY, "base64").length !== 32
    ) {
      ctx.issues.push({
        code: "custom",
        message:
          "DATA_ENCRYPTION_KEY must decode to exactly 32 bytes " +
          "(generate: openssl rand -base64 32)",
        input: ctx.value,
        path: ["DATA_ENCRYPTION_KEY"],
      });
    }
    // Half a keypair is worse than none: the client would offer to subscribe
    // and every send would fail.
    if (
      Boolean(
        ctx.value.VAPID_PUBLIC_KEY || ctx.value.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      ) !== Boolean(ctx.value.VAPID_PRIVATE_KEY)
    ) {
      ctx.issues.push({
        code: "custom",
        message:
          "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set " +
          "together (generate: npx web-push generate-vapid-keys). Back them " +
          "up: rotating them silently unsubscribes every device.",
        input: ctx.value,
        path: ["VAPID_PRIVATE_KEY"],
      });
    }
    if (ctx.value.DATA_SOURCE === "mongodb" && !ctx.value.BETTER_AUTH_SECRET) {
      ctx.issues.push({
        code: "custom",
        message:
          "BETTER_AUTH_SECRET is required when DATA_SOURCE=mongodb (generate: openssl rand -hex 32)",
        input: ctx.value,
        path: ["BETTER_AUTH_SECRET"],
      });
    }
  });

export function validateEnv(): void {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(env)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  if (!parsed.data.ANTHROPIC_API_KEY) {
    console.warn(
      "[env] ANTHROPIC_API_KEY is not set, so AI features (Plan/Ask) will be disabled.",
    );
  }
}
