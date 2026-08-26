// What counts as content, as plain data.
//
// Deliberately free of imports. The repository layer, the backfill and the
// audit all need this list, and the latter two run as standalone scripts —
// putting it beside the Mongo helpers would drag a database connection and
// Next's `server-only` marker into a plain Node process.
//
// The rule for what is missing: ids, dates, enums, colours, orders, counters
// and foreign keys stay readable. They carry little on their own, and keeping
// them plaintext is what lets every query, sort and rollup in the app work
// exactly as before. The honest cost is in ENCRYPTION-PLAN.local.md §3 —
// structure still describes behaviour, so the claim is "your content is
// unreadable", not "nothing about you is knowable".

export type Spec = {
  /** Top-level string fields holding user-authored content. */
  readonly fields: readonly string[];
  /** Arrays of objects with content inside, e.g. subtasks[].title. */
  readonly arrays?: readonly { path: string; fields: readonly string[] }[];
};

export const SPECS = {
  tasks: {
    fields: ["title", "description"],
    arrays: [{ path: "subtasks", fields: ["title"] }],
  },
  notes: { fields: ["title", "body"] },
  projects: { fields: ["title", "description", "label"] },
  goals: { fields: ["title", "metricLabel"] },
  habits: { fields: ["name"] },
  agenda: { fields: ["title"] },
  lifeWeeks: { fields: ["note"] },
  tags: { fields: ["name"] },
  // The URL is the credential: whoever holds it can read that calendar for
  // as long as it lives, with no sign-in. It is encrypted for the same reason
  // the AI key is, and the label goes with it because a calendar's name
  // ("Therapy", "Job interviews") is content in its own right.
  calendarFeeds: { fields: ["label", "url"] },
  // Somebody else's events, but sitting in our database and every bit as
  // readable as the user's own agenda.
  externalEvents: { fields: ["title", "location", "notes"] },
  // A notification is a copy of the thing it is about — "Therapy in 10
  // minutes" is the appointment's title with a clock bolted on. Same
  // treatment as the row it was copied from, or the encryption of the
  // original would be undone by its own reminder.
  notifications: { fields: ["title", "body", "joinUrl"] },
  // The endpoint is a capability: whoever holds it can push to that browser
  // until it is revoked. Same reasoning as a calendar feed URL.
  pushSubscriptions: { fields: ["endpoint", "p256dh", "auth"] },
} as const satisfies Record<string, Spec>;

// Deliberately absent:
//
//   users.name / email — the same values sit in plaintext in Better Auth's own
//     `user` collection, because authentication needs them. Encrypting our
//     copy would look like protection and provide none. It would also
//     deadlock: deriving a user's key needs their row to already exist.
//   settings — configuration, no authored content. `aiApiKeyEnc` is already
//     encrypted separately by lib/crypto.ts.
//   habitEntries, lifeDays — a date and a boolean per row.
//   subscriptions, account, session — billing and auth records.

export type EncryptedCollection = keyof typeof SPECS;

/**
 * SPECS is `as const` so the collection names stay literal, which also makes
 * each entry its own narrow type — only `tasks` is seen to have `arrays`.
 * This widens back to the common shape for code that iterates the specs.
 */
export function specFor(collection: EncryptedCollection): Spec {
  return SPECS[collection];
}

/** Walk a document's content fields, replacing each with fn(value). */
export function mapContent(
  doc: Record<string, unknown>,
  spec: Spec,
  fn: (value: string) => string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...doc };

  for (const field of spec.fields) {
    const value = out[field];
    // Only strings, and only when present. A patch that doesn't mention a
    // field must not gain one, and a null stays null.
    if (typeof value === "string") out[field] = fn(value);
  }

  for (const arr of spec.arrays ?? []) {
    const items = out[arr.path];
    if (!Array.isArray(items)) continue;
    out[arr.path] = items.map((item) => {
      if (!item || typeof item !== "object") return item;
      const copy = { ...(item as Record<string, unknown>) };
      for (const field of arr.fields) {
        const value = copy[field];
        if (typeof value === "string") copy[field] = fn(value);
      }
      return copy;
    });
  }

  return out;
}
