"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  clearJiraConnectionAction,
  saveJiraConnectionAction,
  testJiraConnectionAction,
} from "@/lib/actions/jira";
import { tryAsk, trySave } from "@/lib/try-save";
import { cn } from "@/lib/utils";

type Props = {
  /** The saved address, already worked down to the Jira's root. */
  address: string | null;
  /** The last four characters of the saved token: all of it the screen ever sees. */
  tokenLast4: string | null;
};

const label =
  "font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2";

/**
 * Where the user's Jira lives and their personal token.
 *
 * Both boxes are filled here and nowhere else. The address can be any page of
 * the Jira, since people copy the address bar. The token goes in once and is
 * never shown again: saved, it is only its last four characters.
 */
export function JiraConnection({ address, tokenLast4 }: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [draftAddress, setDraftAddress] = useState(address ?? "");
  const [draftToken, setDraftToken] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const connected = Boolean(address && tokenLast4);
  const changed =
    draftAddress.trim() !== (address ?? "") || draftToken.trim() !== "";

  const save = () => {
    if (!draftAddress.trim()) return;
    setResult(null);
    startTransition(async () => {
      const res = await trySave(() =>
        saveJiraConnectionAction({
          address: draftAddress,
          token: draftToken.trim() || undefined,
        }),
      );
      if (!res?.ok || !res.data) return;
      // Show what was kept, which is the Jira's root, not the page that was pasted.
      setDraftAddress(res.data.address);
      setDraftToken("");
      toast.success("Jira connection saved");
      router.refresh();
    });
  };

  const test = () => {
    setResult(null);
    startTransition(async () => {
      const res = await tryAsk(() => testJiraConnectionAction());
      if (!res) return;
      setResult(
        res.ok && res.data
          ? { ok: true, text: `Connected as ${res.data.name}.` }
          : { ok: false, text: (!res.ok && res.error) || "The test failed." },
      );
    });
  };

  const remove = () => {
    startTransition(async () => {
      const ok = await confirm({
        title: "Remove the Jira connection?",
        description:
          "The address and token are forgotten. Tickets already linked to tasks keep their links.",
        confirmLabel: "Remove",
        destructive: true,
      });
      if (!ok) return;
      const res = await trySave(() => clearJiraConnectionAction());
      if (!res) return;
      setDraftAddress("");
      setDraftToken("");
      setResult(null);
      toast.success("Jira connection removed");
      router.refresh();
    });
  };

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className={label}>Jira address</span>
        <Input
          value={draftAddress}
          disabled={pending}
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste any page of your Jira"
          onChange={(e) => setDraftAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          className="font-mono"
        />
        <span className="text-[12px] text-faint">
          Any page works: the dashboard, a ticket, a board. PUMMA keeps the
          part every page shares. For a Jira your company hosts (Data Center
          or Server), not Atlassian&apos;s cloud yet.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={label}>Personal access token</span>
        <Input
          type="password"
          value={draftToken}
          disabled={pending}
          autoComplete="off"
          spellCheck={false}
          placeholder={
            tokenLast4
              ? `Saved, ending in ${tokenLast4}. Blank keeps it for this address`
              : "Paste your token"
          }
          onChange={(e) => setDraftToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
          className="font-mono"
        />
        <span className="text-[12px] text-faint">
          Made in Jira under your profile, Personal Access Tokens. Stored
          encrypted, used only by PUMMA&apos;s server to talk to that address,
          and never shown again.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={pending || !changed}>
          Save
        </Button>
        <Button
          variant="outline"
          onClick={test}
          disabled={pending || !connected || changed}
        >
          Test connection
        </Button>
        {(address || tokenLast4) && (
          <Button variant="outline" onClick={remove} disabled={pending}>
            Remove
          </Button>
        )}
      </div>

      {result && (
        <p
          role="status"
          className={cn(
            "m-0 text-[12.5px] font-medium",
            result.ok ? "text-habits" : "text-tasks",
          )}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
