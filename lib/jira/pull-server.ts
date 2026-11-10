import "server-only";

import {
  bringIn,
  whatIsHere,
  type Brought,
} from "@/lib/jira/bring-in-server";
import { JIRA_UNREADABLE, jiraConnection } from "@/lib/jira/connection-server";
import type { PullRunInput } from "@/lib/jira/pull-input";
import { planPull, type PullForest } from "@/lib/jira/pull-plan";
import { readPull, type PullRead, type PullSource } from "@/lib/jira/pull-read";

// The two things the "From Jira" sheet asks of the server: show me what this
// pull would bring, and bring it.

export type PullPreview =
  | {
      state: "ok";
      forest: PullForest;
      /** There is more in Jira than was read. */
      capped: boolean;
      /** Ticket numbers already here, so the screen can plan exactly as the server will. */
      have: { tasks: string[]; projects: string[] };
    }
  | { state: "no-connection" }
  | { state: "failed"; error: string };

export type PullRun =
  | { state: "ok"; brought: Brought }
  | { state: "no-connection" }
  | { state: "failed"; error: string };

// What was read for a preview is kept a few minutes, for two reasons: pressing
// Read twice is not two trips to Jira, and "Bring in" makes what was on screen
// rather than whatever Jira says a minute later.
const READS = new Map<string, { at: number; read: PullRead }>();
/** A second Read inside this window shows the first one's answer. */
const READ_AGAIN_MS = 30_000;
/** "Bring in" uses a preview this young; older than this, it reads again. */
const READ_KEPT_MS = 5 * 60_000;
const READS_KEPT = 200;

const readKey = (userId: string, baseUrl: string, source: PullSource) =>
  [
    userId,
    baseUrl,
    source.kind === "mine"
      ? "mine"
      : `${source.key.trim().toUpperCase()}|${source.children}`,
  ].join("|");

type Reading =
  | { state: "ok"; baseUrl: string; read: PullRead }
  | { state: "no-connection" }
  | { state: "failed"; error: string };

async function reading(
  userId: string,
  source: PullSource,
  youngerThan: number,
): Promise<Reading> {
  const conn = await jiraConnection(userId);
  if (conn.state === "none") return { state: "no-connection" };
  if (conn.state === "unreadable") {
    return { state: "failed", error: JIRA_UNREADABLE };
  }
  const key = readKey(userId, conn.baseUrl, source);
  const kept = READS.get(key);
  if (kept && Date.now() - kept.at < youngerThan) {
    return { state: "ok", baseUrl: conn.baseUrl, read: kept.read };
  }
  const res = await readPull(conn, source);
  if (!res.ok) return { state: "failed", error: res.error };
  if (READS.size >= READS_KEPT) READS.clear();
  READS.set(key, { at: Date.now(), read: res.data });
  return { state: "ok", baseUrl: conn.baseUrl, read: res.data };
}

/** Forget every kept read. For tests. */
export function forgetPullReads(): void {
  READS.clear();
}

/** What `source` would bring in, and what of it is here already. Makes nothing. */
export async function previewPull(
  userId: string,
  source: PullSource,
): Promise<PullPreview> {
  const got = await reading(userId, source, READ_AGAIN_MS);
  if (got.state !== "ok") return got;
  const { have } = await whatIsHere(userId, got.baseUrl);
  return {
    state: "ok",
    forest: got.read.forest,
    capped: got.read.capped,
    have: { tasks: [...have.tasks], projects: [...have.projects] },
  };
}

/**
 * Bring `source` in. The plan is worked out here, from the server's own read
 * and from what is in the database at this moment: the screen only says which
 * level is the project and which tickets were unticked.
 */
export async function runPull(
  userId: string,
  input: PullRunInput,
): Promise<PullRun> {
  const got = await reading(userId, input.source, READ_KEPT_MS);
  if (got.state !== "ok") return got;
  const { have, projectOf } = await whatIsHere(userId, got.baseUrl);
  const off = new Set(input.off.map((k) => k.trim().toUpperCase()));
  const plan = planPull(got.read.forest, input.level, off, have);
  const brought = await bringIn(userId, plan, projectOf);
  // What was kept describes the moment before this: the next preview reads again.
  READS.delete(readKey(userId, got.baseUrl, input.source));
  return { state: "ok", brought };
}
