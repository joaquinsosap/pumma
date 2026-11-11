import "server-only";

import { createHash } from "node:crypto";

import {
  bringIn,
  whatIsHere,
  type Brought,
} from "@/lib/jira/bring-in-server";
import { JIRA_UNREADABLE, jiraConnection } from "@/lib/jira/connection-server";
import { narrowPull } from "@/lib/jira/pull-filter";
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
      /** False when Jira would not say whose token this is: nothing is marked as assigned to them. */
      whoKnown: boolean;
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

// The token is part of the key, as a short digest: what one token may see is
// not what another may, and a changed connection must not be shown the old one's read.
const readKey = (
  userId: string,
  conn: { baseUrl: string; token: string },
  source: PullSource,
) =>
  [
    userId,
    conn.baseUrl,
    createHash("sha256").update(conn.token).digest("hex").slice(0, 12),
    source.kind === "mine"
      ? "mine"
      : `${source.key.trim().toUpperCase()}|${source.children}`,
  ].join("|");

type Reading =
  | { state: "ok"; baseUrl: string; key: string; read: PullRead }
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
  const key = readKey(userId, conn, source);
  const kept = READS.get(key);
  if (kept && Date.now() - kept.at < youngerThan) {
    return { state: "ok", baseUrl: conn.baseUrl, key, read: kept.read };
  }
  const res = await readPull(conn, source);
  if (!res.ok) return { state: "failed", error: res.error };
  if (READS.size >= READS_KEPT) READS.clear();
  READS.set(key, { at: Date.now(), read: res.data });
  return { state: "ok", baseUrl: conn.baseUrl, key, read: res.data };
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
    whoKnown: got.read.whoKnown,
    have: { tasks: [...have.tasks], projects: [...have.projects] },
  };
}

/**
 * Bring `source` in. The plan is worked out here, from the server's own read
 * and from what is in the database at this moment: the screen only says which
 * level is the project, how its selectors are set and which tickets were
 * unticked.
 */
export function runPull(userId: string, input: PullRunInput): Promise<PullRun> {
  return oneAtATime(userId, async () => {
    const got = await reading(userId, input.source, READ_KEPT_MS);
    if (got.state !== "ok") return got;
    // Read inside the turn: a bring-in that ran just before this one has
    // already made its project and tasks, and this one must see them.
    const { have, projectOf } = await whatIsHere(userId, got.baseUrl);
    const unticked = new Set(input.off.map((k) => k.trim().toUpperCase()));
    // Narrowed here, by the rule the screen used. When this read is newer than
    // the one on screen, a ticket that has since been finished or handed to
    // somebody else is still left out, because the selectors say so.
    const { off } = narrowPull(
      got.read.forest,
      {
        // Whose tickets only means something where they differ and can be told apart.
        who: input.source.kind === "ticket" && got.read.whoKnown ? input.who : "all",
        stages: new Set(input.stages),
      },
      unticked,
    );
    const plan = planPull(got.read.forest, input.level, off, have);
    const brought = await bringIn(userId, plan, projectOf);
    // What was kept describes the moment before this: the next preview reads again.
    READS.delete(got.key);
    return { state: "ok", brought };
  });
}

// Bring-ins for one account run one after another. "Is this ticket here yet?"
// is asked before anything is written, so two at once (two tabs, an impatient
// second press) would both hear "no" and both make the project. The app runs
// as one process, so a queue in memory is the whole of the lock.
const TURNS = new Map<string, Promise<unknown>>();

function oneAtATime<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const before = TURNS.get(userId) ?? Promise.resolve();
  // Whatever the turn before came to, this one still runs.
  const mine = before.then(work, work);
  const settled = mine.catch(() => {});
  TURNS.set(userId, settled);
  void settled.then(() => {
    if (TURNS.get(userId) === settled) TURNS.delete(userId);
  });
  return mine;
}
