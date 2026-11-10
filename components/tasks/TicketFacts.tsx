"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "@/components/icons";
import { readTicketAction } from "@/lib/actions/jira";
import type { JiraStage, TicketRead } from "@/lib/jira/issue";
import { cn } from "@/lib/utils";

/** How long an answer is shown again without asking: folding the card shut and open is not a reason to call Jira. */
const FRESH_MS = 60_000;
/** Per page, not per card, so the same ticket on two tasks is asked about once. */
const READS = new Map<string, { at: number; read: TicketRead }>();
const fresh = (url: string) => {
  const hit = READS.get(url);
  return hit && Date.now() - hit.at < FRESH_MS ? hit.read : null;
};

const label =
  "font-mono text-[9px] uppercase tracking-widest text-faint2 pt-[3px]";

const STAGE_DOT: Record<JiraStage, string> = {
  todo: "bg-faint",
  doing: "bg-notes",
  done: "bg-habits",
};

/**
 * Where a linked ticket stands in Jira: its step, who has it, what kind it is.
 *
 * Read when the card is unfolded and on Refresh, never stored. Mount it with
 * the link as its key, so another link starts from nothing.
 */
export function TicketFacts({ url }: { url: string }) {
  const [read, setRead] = useState<TicketRead | null>(() => fresh(url));
  const [loading, setLoading] = useState(() => !fresh(url));
  const alive = useRef(true);

  const ask = useCallback(async () => {
    let next: TicketRead;
    try {
      const res = await readTicketAction({ url });
      next =
        res.ok && res.data
          ? res.data
          : { state: "failed", error: "PUMMA could not read this ticket." };
    } catch {
      // A lost connection is this card's problem, not the page's.
      next = { state: "failed", error: "PUMMA's server did not answer." };
    }
    READS.set(url, { at: Date.now(), read: next });
    if (!alive.current) return;
    setRead(next);
    setLoading(false);
  }, [url]);

  useEffect(() => {
    alive.current = true;
    if (!fresh(url)) void ask();
    return () => {
      alive.current = false;
    };
  }, [url, ask]);

  const refresh = () => {
    if (loading) return;
    setLoading(true);
    void ask();
  };

  if (!read) {
    return <p className="m-0 mb-3 text-[11px] text-faint">Reading from Jira</p>;
  }

  if (read.state === "no-connection") {
    return (
      <p className="m-0 mb-3 text-[11px] leading-snug text-faint">
        Connect your Jira to see where this ticket stands.{" "}
        <Link
          href="/settings#jira"
          className="font-semibold text-muted underline-offset-2 hover:text-ink hover:underline"
        >
          Open Settings
        </Link>
      </p>
    );
  }

  if (read.state === "elsewhere") {
    return (
      <p className="m-0 mb-3 text-[11px] leading-snug text-faint">
        This ticket is not on your connected Jira, so only its link is kept.
      </p>
    );
  }

  const again = (
    <button
      type="button"
      onClick={refresh}
      disabled={loading}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-semibold text-muted transition-colors hover:border-faint hover:text-ink disabled:opacity-60"
    >
      <RefreshCw
        aria-hidden
        className={cn("h-3 w-3", loading && "animate-spin")}
        strokeWidth={2.2}
      />
      {read.state === "failed" ? "Try again" : "Refresh"}
    </button>
  );

  if (read.state === "failed") {
    return (
      <div className="mb-3">
        <p role="status" className="m-0 mb-2 text-[11px] leading-snug text-tasks">
          {read.error}
        </p>
        {again}
      </div>
    );
  }

  const { facts } = read;
  return (
    <div className="mb-3">
      <dl
        className={cn(
          "m-0 mb-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px] leading-snug text-ink transition-opacity",
          loading && "opacity-60",
        )}
      >
        <dt className={label}>Status</dt>
        <dd className="m-0 flex min-w-0 items-center gap-1.5">
          {facts.stage && (
            <span
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                STAGE_DOT[facts.stage],
              )}
            />
          )}
          <span className="min-w-0 truncate font-semibold">
            {facts.status ?? "Not said"}
          </span>
        </dd>
        <dt className={label}>Who has it</dt>
        <dd className={cn("m-0 min-w-0 truncate", !facts.assignee && "text-faint")}>
          {facts.assignee ?? "Nobody"}
        </dd>
        {facts.type && (
          <>
            <dt className={label}>Type</dt>
            <dd className="m-0 min-w-0 truncate">{facts.type}</dd>
          </>
        )}
        {facts.priority && (
          <>
            <dt className={label}>Priority</dt>
            <dd className="m-0 min-w-0 truncate">{facts.priority}</dd>
          </>
        )}
        {facts.title && (
          <>
            <dt className={label}>In Jira</dt>
            <dd className="m-0 min-w-0 break-words text-muted">{facts.title}</dd>
          </>
        )}
      </dl>
      {again}
    </div>
  );
}
