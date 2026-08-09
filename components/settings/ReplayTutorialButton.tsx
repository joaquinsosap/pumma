"use client";

import { Play } from "@/components/icons";
import { replayTutorial } from "@/lib/actions/settings";
import { requestTutorialReplay } from "@/lib/tutorial-replay";

/**
 * Watch the tour again — starting on the frame you press it.
 *
 * It used to await the server, then push to home, then refresh: three round
 * trips before anything happened, and a button that sat on "Rolling…" for
 * seconds. None of that was needed. The overlay lives in the app layout, so it
 * is already mounted on this page and can open where you are; its backdrop is
 * blurred either way. The database write still happens — afterwards, and
 * unwatched, because nothing on screen is waiting for it.
 */
export function ReplayTutorialButton() {
  return (
    <button
      type="button"
      onClick={() => {
        requestTutorialReplay();
        void replayTutorial();
      }}
      className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] font-semibold text-ink transition-colors hover:border-faint"
    >
      <Play className="h-3.5 w-3.5 fill-current" />
      Play the 60-second tour again
    </button>
  );
}
