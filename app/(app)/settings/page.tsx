import { loadShellData } from "@/lib/data";
import { displayName } from "@/lib/user-display";
import { resolveLifeView } from "@/lib/life-view-server";
import { isAuthEnabled, requireAccess } from "@/lib/auth/session";
import { billingEnabled } from "@/lib/billing/access";
import { accountDeletionBlock } from "@/lib/actions/account";
import { starterStatus } from "@/lib/actions/starter";
import { SettingsView } from "@/components/settings/SettingsView";
import { tagCount } from "@/lib/metrics";

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
      stats={{ dayPct: 0, habitsLabel: "—", topStreak: 0 }}
    />
  );
}
