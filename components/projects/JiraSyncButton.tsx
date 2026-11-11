"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { JiraMark, RefreshCw } from "@/components/icons";
import { useTimezone } from "@/components/shell/TimeZoneProvider";
import { syncHint, syncSaid } from "@/lib/jira/sync-said";
import type { JiraSync } from "@/lib/jira/sync-server";
import { cn } from "@/lib/utils";

// When each project may be asked about again, as the server last said. Kept
// outside the component so going to another project and back asks nothing.
const NEXT_AT = new Map<string, number>();
const READ_AT = new Map<string, number>();

/**
 * Keeps one project's tasks in step with their Jira tickets.
 *
 * It reads when the project is opened and when the window is come back to;
 * the server decides whether Jira is really asked (ten to twenty minutes
 * apart). Pressing it reads now. Drawn only on a project that holds tickets
 * of the connected Jira.
 */
export function JiraSyncButton({
  projectId,
  className,
}: {
  projectId: string;
  className?: string;
}) {
  const router = useRouter();
  const timeZone = useTimezone();
  const [reading, setReading] = useState(false);
  const [readAt, setReadAt] = useState<number | null>(
    READ_AT.get(projectId) ?? null,
  );
  const busy = useRef(false);

  const ask = useCallback(
    async (byHand: boolean) => {
      if (busy.current) return;
      if (!byHand && Date.now() < (NEXT_AT.get(projectId) ?? 0)) return;
      busy.current = true;
      setReading(true);
      try {
        const res = await fetch("/api/jira/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, byHand }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const result = (await res.json()) as JiraSync;
        if ("nextAt" in result) NEXT_AT.set(projectId, result.nextAt);
        if (result.state === "ok") {
          READ_AT.set(projectId, Date.now());
          setReadAt(Date.now());
          // The server answered a moment ago, so this page is safe to ask for.
          if (result.moved > 0) router.refresh();
        }
        const said = syncSaid(result, byHand);
        if (said?.tone === "bad") toast.error(said.text);
        else if (said?.tone === "good") toast.success(said.text);
        else if (said) toast(said.text);
      } catch {
        // Asked in the background, there is nobody to tell. Asked by hand, say so.
        if (byHand) toast.error("PUMMA's server did not answer. Try again.");
      } finally {
        busy.current = false;
        setReading(false);
      }
    },
    [projectId, router],
  );

  useEffect(() => {
    setReadAt(READ_AT.get(projectId) ?? null);
    void ask(false);
    const back = () => {
      if (document.visibilityState === "visible") void ask(false);
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [projectId, ask]);

  const hint = reading ? "Reading Jira" : syncHint(readAt, timeZone);
  return (
    <button
      type="button"
      onClick={() => void ask(true)}
      disabled={reading}
      aria-label={hint}
      title={hint}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-2 transition-colors hover:border-faint2 disabled:opacity-60",
        className,
      )}
    >
      {/* The blue is on the mark itself: the theme sets a button's own text colour. */}
      <JiraMark className="h-3.5 w-3.5 text-jira" />
      <RefreshCw
        aria-hidden
        className={cn("h-3 w-3 text-muted", reading && "animate-spin")}
        strokeWidth={2.4}
      />
    </button>
  );
}
