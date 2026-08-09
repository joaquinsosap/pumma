"use client";

import { useState, useTransition } from "react";
import { Download, TriangleAlert } from "@/components/icons";
import { toast } from "sonner";
import {
  deleteAccountAction,
  type DeleteAccountBlock,
} from "@/lib/actions/account";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DataSection({
  userEmail,
  deletionBlock,
}: {
  userEmail: string | null;
  /** Set when something (today: a live subscription) must be sorted first. */
  deletionBlock: DeleteAccountBlock | null;
}) {
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();

  // Memory mode has no email on file; the action accepts this phrase instead.
  const expected =
    (userEmail ?? "").trim().toLowerCase() || "delete my account";
  const matches = typed.trim().toLowerCase() === expected;

  const handleDelete = () => {
    startTransition(async () => {
      const res = await deleteAccountAction({ confirmation: typed });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // Everything it could render is gone; get off the page before it tries.
      window.location.href = "/";
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="m-0 text-[13px] font-semibold text-ink">
          Download your data
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-faint">
          One JSON file with every task, note, habit, goal, project, tag and
          setting on this account. Your stored AI key is left out on purpose.
        </p>
        <a
          href="/api/account/export"
          download
          className="mt-2.5 inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] font-semibold text-ink no-underline transition-colors hover:border-faint hover:bg-hover"
        >
          <Download className="h-3.5 w-3.5" />
          Download export
        </a>
      </div>

      <div className="border-t border-border2 pt-5">
        <p className="m-0 flex items-center gap-1.5 text-[13px] font-semibold text-tasks">
          <TriangleAlert className="h-3.5 w-3.5" />
          Delete this account
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-faint">
          Removes the account and everything in it, permanently, with no way
          back and no copy kept. Download your data first if you want it.
        </p>

        {deletionBlock ? (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2.5">
            <p className="m-0 text-[12px] font-semibold text-amber-700 dark:text-amber-500">
              Cancel your subscription first
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted">
              Your subscription is {deletionBlock.status}. We can&apos;t cancel
              it for you, so deleting now would leave you paying for an account
              that no longer exists. Cancel it with the payment provider. The
              Subscription card above links there, and this unlocks once they
              tell us billing has stopped.
            </p>
          </div>
        ) : !armed ? (
          <button
            type="button"
            onClick={() => setArmed(true)}
            className="mt-2.5 rounded-lg border border-tasks/40 bg-tasks/[0.06] px-3 py-2 text-[12.5px] font-semibold text-tasks transition-colors hover:border-tasks/60 hover:bg-tasks/10"
          >
            Delete account…
          </button>
        ) : (
          <div className="mt-3 rounded-lg border border-tasks/40 bg-tasks/[0.04] p-3">
            <label className="block text-[12px] text-muted">
              Type{" "}
              <span className="font-mono font-semibold text-ink">
                {expected}
              </span>{" "}
              to confirm.
            </label>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label="Type your email to confirm deletion"
              className={cn(
                "mt-2 w-full rounded-lg border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none transition-colors",
                matches ? "border-tasks" : "border-border focus:border-faint",
              )}
            />
            <div className="mt-2.5 flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleDelete}
                disabled={!matches || pending}
                className="bg-tasks text-white hover:bg-tasks/90"
              >
                {pending ? "Deleting…" : "Delete everything"}
              </Button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setArmed(false);
                  setTyped("");
                }}
                className="rounded-lg px-2.5 py-2 text-[12.5px] font-semibold text-faint transition-colors hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
