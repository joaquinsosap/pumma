// What the Jira button on a project says, and what it tells the owner after a read.

import type { JiraSync } from "@/lib/jira/sync-server";

/** The line shown after a read. Null when there is nothing worth saying. */
export function syncSaid(
  result: JiraSync,
  byHand: boolean,
): { tone: "good" | "plain" | "bad"; text: string } | null {
  if (result.state === "ok") {
    if (result.moved > 0) {
      return {
        tone: "good",
        text:
          result.moved === 1
            ? "1 task moved to match Jira"
            : `${result.moved} tasks moved to match Jira`,
      };
    }
    // Read without being asked, and nothing changed: nothing to interrupt for.
    return byHand ? { tone: "plain", text: "Jira has nothing new" } : null;
  }
  if (!byHand) return null;
  if (result.state === "waiting") {
    return {
      tone: "plain",
      text: "Jira was read a moment ago. Try again in a minute.",
    };
  }
  if (result.state === "failed") return { tone: "bad", text: result.error };
  if (result.state === "no-connection") {
    return {
      tone: "bad",
      text: "No Jira is connected. Add one in Settings, Connections.",
    };
  }
  return { tone: "plain", text: "No task here holds a Jira ticket" };
}

/** The hint on the button: when Jira was last read, in the owner's clock. */
export function syncHint(readAt: number | null, timeZone: string): string {
  if (readAt === null) return "Read this project's tickets from Jira";
  const at = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(readAt));
  return `Read from Jira at ${at}. Press to read again.`;
}
