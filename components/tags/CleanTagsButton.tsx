"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "@/components/icons";
import { toast } from "sonner";
import { cleanUnusedTagsAction, restoreTagsAction } from "@/lib/actions/tags";
import { cn } from "@/lib/utils";

/**
 * "Clean unused tags", with an undo in the toast — the same safety net task
 * creation gets. Lives in Settings so the action is reachable on phones too,
 * where the tag rail (and its own Clean button) isn't rendered.
 */
export function CleanTagsButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const run = async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await cleanUnusedTagsAction();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const removed = res.data?.removed ?? 0;
      if (!removed) {
        toast.success("No unused tags to clean");
        return;
      }
      const snapshot = res.undo?.snapshot;
      toast.success(
        removed === 1
          ? `Removed unused tag "${res.data?.names[0]}"`
          : `Removed ${removed} unused tags`,
        {
          action: snapshot
            ? {
                label: "UNDO",
                onClick: async () => {
                  const back = await restoreTagsAction(snapshot);
                  if (!back.ok) toast.error(back.error);
                  else toast.success("Tags restored");
                  router.refresh();
                },
              }
            : undefined,
        },
      );
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] font-semibold text-ink transition-colors hover:border-faint hover:bg-hover disabled:opacity-50",
        className,
      )}
    >
      <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
      {pending ? "Cleaning…" : "Clean unused tags"}
    </button>
  );
}
