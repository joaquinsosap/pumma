"use client";

import type { Scope } from "@/lib/ai/scope-schema";

/**
 * Opening the scope screen without spending a model call.
 *
 * The screen only appears after the assistant returns a `bulk` response, which
 * costs an API request and depends on the model choosing that branch. Checking
 * a spacing change meant paying for a generation and hoping the router agreed
 * — so this fabricates the one input the screen takes.
 *
 * ## Why this is not a vulnerability
 *
 * The gate is `process.env.NODE_ENV`, which Next inlines at BUILD time. In a
 * production build the comparison is a literal `false` and everything below it
 * is removed by the minifier: no runtime flag, no environment variable to set
 * wrongly, no header or cookie that turns it back on. It cannot be reached in
 * production because it is not there.
 *
 * Even if it did run it would only DRAW a screen. The scope it fabricates is
 * resolved by the same server action as any other, against the signed-in
 * user's own rows, and nothing is written until they press Draft.
 *
 * Usage: `?bulk=1` on /assistant.
 */
export type DevBulk = {
  summary: string;
  scope: Scope;
  patch: { priority: "high" };
  remove: false;
} | null;

export function readBulkOverride(): DevBulk {
  if (process.env.NODE_ENV === "production") return null;
  if (typeof window === "undefined") return null;
  if (!new URLSearchParams(window.location.search).has("bulk")) return null;

  // The request from the bug report, with the assumption it got wrong.
  return {
    summary: "Set high priority on the 3 oldest open tasks",
    scope: {
      entity: "task",
      filters: { status: ["todo", "doing"] },
      sort: { by: "created", reversed: false },
      count: 3,
      assumed: ["status", "sort"],
    },
    patch: { priority: "high" },
    remove: false,
  };
}
