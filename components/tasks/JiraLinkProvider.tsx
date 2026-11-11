"use client";

import { createContext, useCallback, useContext } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { moveKept, moveSaid } from "@/lib/jira/move-said";
import type { JiraMove } from "@/lib/jira/move-server";
import type { JiraStatusMap } from "@/lib/jira/status-map";
import type { TaskColumn } from "@/lib/jira/status-sync";
import { ticketFromUrl } from "@/lib/ticket-link";

// The status map from Settings, for every screen that moves a task or shows
// its ticket. Null when no Jira is connected: then nothing is sent or marked.
const JiraLinkContext = createContext<JiraStatusMap | null>(null);

export function JiraLinkProvider({
  map,
  children,
}: {
  map: JiraStatusMap | null;
  children: React.ReactNode;
}) {
  return <JiraLinkContext.Provider value={map}>{children}</JiraLinkContext.Provider>;
}

export function useJiraStatusMap(): JiraStatusMap | null {
  return useContext(JiraLinkContext);
}

/**
 * Send a task's column to its ticket, and say what Jira answered.
 *
 * Called once a move has been saved here, never before: the server sends the
 * column the task is in when it asks. A column that sends nothing costs no
 * request at all.
 */
export function useSendToJira() {
  const map = useJiraStatusMap();
  const router = useRouter();
  return useCallback(
    async (
      task: { id: string; ticketUrl?: string | null },
      column: TaskColumn,
      { byHand = false }: { byHand?: boolean } = {},
    ) => {
      if (!map || ticketFromUrl(task.ticketUrl)?.kind !== "jira") return;
      if (!map.to[column] && !byHand) return;
      let result: JiraMove;
      try {
        const res = await fetch("/api/jira/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: task.id }),
        });
        if (!res.ok) throw new Error(String(res.status));
        result = (await res.json()) as JiraMove;
      } catch {
        toast.error(
          "PUMMA's server did not answer, so Jira was not told. Use Send to Jira on the task.",
        );
        return;
      }
      const said = moveSaid(result, byHand);
      if (said?.tone === "bad") toast.error(said.text);
      else if (said?.tone === "good") toast.success(said.text);
      else if (said) toast(said.text);
      // The server answered a moment ago, so this page is safe to ask for.
      if (moveKept(result)) router.refresh();
    },
    [map, router],
  );
}
