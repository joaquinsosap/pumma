// Which collections an account owns, for export and delete; account-collections.test.ts fails on any collection the app writes that is missing here.

/** The account's own records, keyed by its string userId: exported, then deleted. */
export const EXPORTED_COLLECTIONS = [
  "agenda",
  "aiUsage",
  "calendarFeeds",
  "externalEvents",
  "goals",
  "habitEntries",
  "habits",
  "lifeDays",
  "lifeWeeks",
  "notes",
  "notifications",
  "projects",
  "settings",
  "subscriptions",
  "tags",
  "tasks",
] as const;

/** Credentials and housekeeping: deleted, never exported. Sign-in material first, so a half-finished run leaves no way back in. */
export const DELETE_ONLY_COLLECTIONS = [
  "session",
  "account",
  "oauthAccessToken",
  "oauthRefreshToken",
  "oauthConsent",
  "oauthClient",
  "pushSubscriptions",
  "mcpAudit",
  "mcpConfirm",
  "mcpRate",
] as const;

/** Rows keyed by `_id` rather than `userId`: the app profile and the Better Auth user. Handled by name in each backend. */
export const PROFILE_COLLECTIONS = ["users", "user"] as const;

/** Collections with no per-account rows, and why they are kept. */
export const NOT_ACCOUNT_DATA: Record<string, string> = {
  counters: "running totals, such as how many demos were ever handed out",
  rateLimits: "per-IP counters, pruned on their own",
  webhookEvents: "Gumroad delivery ids, kept so a retried webhook is not applied twice; no account data",
  verification: "Better Auth's short-lived codes, keyed by value not userId; they expire in minutes and fail once the account is gone",
};
