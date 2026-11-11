// What the screen says after a task's move was sent to Jira.

import type { JiraMove } from "@/lib/jira/move-server";

/** The line shown after a send. Null when there is nothing worth saying. */
export function moveSaid(
  result: JiraMove,
  byHand: boolean,
): { tone: "good" | "plain" | "bad"; text: string } | null {
  switch (result.state) {
    case "sent":
      return { tone: "good", text: `${result.key} is now ${result.status} in Jira` };
    case "already":
      return byHand
        ? { tone: "plain", text: `${result.key} is already ${result.status} in Jira` }
        : null;
    case "held":
    case "refused":
    case "not-yours":
    case "failed":
      return { tone: "bad", text: result.error };
    case "off":
      return byHand
        ? {
            tone: "plain",
            text: "This column sends nothing to Jira. Choose what it sends in Settings, Connections, Jira.",
          }
        : null;
    case "no-ticket":
      return byHand
        ? { tone: "bad", text: "This task holds no ticket of your connected Jira." }
        : null;
    case "no-connection":
      return byHand
        ? { tone: "bad", text: "No Jira is connected. Add one in Settings, Connections." }
        : null;
  }
}

/** Whether what Jira said was kept on the task, so the page has something new to show. */
export const moveKept = (result: JiraMove) =>
  result.state === "sent" ||
  result.state === "already" ||
  result.state === "refused" ||
  result.state === "not-yours";
