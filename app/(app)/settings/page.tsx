import { loadShellData } from "@/lib/data";
import { vapidPublicKey } from "@/lib/push";
import { displayName } from "@/lib/user-display";
import { resolveLifeView } from "@/lib/life-view-server";
import { isAuthEnabled, requireAccess } from "@/lib/auth/session";
import { billingEnabled } from "@/lib/billing/access";
import { accountDeletionBlock } from "@/lib/actions/account";
import { starterStatus } from "@/lib/actions/starter";
import { SettingsView } from "@/components/settings/SettingsView";
import { tagCount } from "@/lib/metrics";
import { mcpAvailable, mcpResourceUrl } from "@/lib/mcp/config";
import { listMcpAudit } from "@/lib/db/mcp-audit";
import { listConnectedClients } from "@/lib/mcp/connections";
import { getSessionUserId } from "@/lib/auth/session";

export default async function SettingsPage() {
  const lifeView = await resolveLifeView();
  const data = await loadShellData({ lifeView });
  // Billing card only for hosted subscribers — owners and demo accounts have
  // nothing to manage, and self-hosted installs never enable billing at all.
  const showSubscription =
    billingEnabled() && (await requireAccess()) === "subscribed";
  // Resolved on the server so the Data section can explain the block before
  // the user types anything, rather than failing after they commit.
  const deletionBlock = await accountDeletionBlock();
  // Null for an account that never had examples, or has finished with them —
  // which is what keeps the button from appearing to everyone forever.
  const starter = await starterStatus();
  // How often each tag is actually used — the "Most used" sort reads this,
  // and it is cheap here where the tasks and notes are already loaded.
  const tagCounts = Object.fromEntries(
    data.tags.map((t) => [t.id, tagCount(t.id, data.allTasks, data.notes)]),
  );

  // Empty when this instance does not serve MCP (memory mode, or the operator
  // kill switch), which is what hides the panel rather than showing switches
  // that could not do anything.
  const mcpEndpoint = mcpAvailable() ? mcpResourceUrl() : "";
  // Only worth reading when the panel will render it.
  const userId = mcpEndpoint ? await getSessionUserId() : null;
  const mcpActivity = userId ? await listMcpAudit(userId, 8) : [];
  const mcpClients = userId ? await listConnectedClients(userId) : [];

  return (
    <SettingsView
      settings={data.settings}
      userName={displayName(data.user)}
      userEmail={data.user?.email ?? null}
      authEnabled={isAuthEnabled()}
      showSubscription={showSubscription}
      deletionBlock={deletionBlock}
      starter={starter}
      tags={data.tags}
      tagCounts={tagCounts}
      calendarFeeds={data.calendarFeeds}
      // Public half of the VAPID pair, read at runtime and handed over as a
      // prop. See vapidPublicKey() for why it is not a NEXT_PUBLIC_ variable.
      pushPublicKey={vapidPublicKey()}
      mcpEndpoint={mcpEndpoint}
      mcpActivity={mcpActivity}
      mcpClients={mcpClients}
      stats={{ dayPct: 0, habitsLabel: "—", topStreak: 0 }}
    />
  );
}
