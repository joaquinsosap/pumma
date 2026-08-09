"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, KeyRound, Plug } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeleteButton } from "@/components/ui/delete-button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  setAiApiKeyAction,
  setAiModelAction,
  setAiProviderAction,
  clearAiApiKeyAction,
} from "@/lib/actions/settings";
import { testAiConnectionAction } from "@/lib/actions/ai-test";
import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  isProviderId,
  providerDef,
  type ProviderId,
} from "@/lib/ai/providers";

const GROUPS: { label: string; group: "vendor" | "gateway" | "local" }[] = [
  { label: "Model vendors", group: "vendor" },
  { label: "Gateways & fast hosts", group: "gateway" },
  { label: "Local", group: "local" },
];

const selectClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm";

type Props = {
  provider: string | null | undefined;
  model: string | null | undefined;
  last4: string | null;
};

/**
 * Provider, model and key for the assistant.
 *
 * The provider list is closed and the endpoints come from the registry, so the
 * only free text here is a model name — everything else is a choice from a
 * list, which is also what keeps the server from being pointed at an arbitrary
 * host.
 */
export function AssistantProviderFields({ provider, model, last4 }: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();

  const current: ProviderId = isProviderId(provider) ? provider : DEFAULT_PROVIDER;
  const def = providerDef(current);
  const known = def.models.includes(model ?? "");

  const [custom, setCustom] = useState(!known && Boolean(model));
  const [draftModel, setDraftModel] = useState(model ?? "");
  const [draftKey, setDraftKey] = useState("");
  const [editingKey, setEditingKey] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true; text: string } | { ok: false; text: string } | null
  >(null);

  const configured = last4 !== null;
  const keyRequired = !def.keyOptional;

  const changeProvider = (next: string) => {
    if (!isProviderId(next) || next === current) return;
    startTransition(async () => {
      // The key goes with the provider — see setAiProviderAction.
      if (configured) {
        const ok = await confirm({
          title: `Switch to ${providerDef(next).label}?`,
          description: `Your ${def.label} key will be removed — keys don't work across providers. You'll need to paste a ${providerDef(next).label} key.`,
          confirmLabel: "Switch",
        });
        if (!ok) return;
      }
      const res = await setAiProviderAction(next);
      if (!res.ok) {
        toast.error(res.error ?? "Could not switch provider");
        return;
      }
      setCustom(false);
      setDraftModel("");
      setDraftKey("");
      setTestResult(null);
      router.refresh();
    });
  };

  const saveModel = (value: string) => {
    startTransition(async () => {
      const res = await setAiModelAction(value);
      if (!res.ok) {
        toast.error(res.error ?? "Could not save model");
        return;
      }
      setTestResult(null);
      router.refresh();
    });
  };

  const saveKey = () => {
    const key = draftKey.trim();
    if (!key) return;
    startTransition(async () => {
      const res = await setAiApiKeyAction(key);
      if (!res.ok) {
        toast.error(res.error ?? "Could not save key");
        return;
      }
      toast.success("API key saved");
      setDraftKey("");
      setEditingKey(false);
      setTestResult(null);
      router.refresh();
    });
  };

  const removeKey = () => {
    startTransition(async () => {
      const ok = await confirm({
        title: "Remove API key?",
        description: "Plan and Ask will stop working until you add a key again.",
        confirmLabel: "Remove",
        destructive: true,
      });
      if (!ok) return;
      const res = await clearAiApiKeyAction();
      if (!res.ok) {
        toast.error(res.error ?? "Could not remove key");
        return;
      }
      toast.success("API key removed");
      setDraftKey("");
      setEditingKey(false);
      setTestResult(null);
      router.refresh();
    });
  };

  const test = () => {
    setTestResult(null);
    startTransition(async () => {
      const res = await testAiConnectionAction();
      if (res.ok && res.data) {
        setTestResult({
          ok: true,
          text: `${res.data.provider} answered on ${res.data.model}.`,
        });
        return;
      }
      setTestResult({
        ok: false,
        text: (!res.ok && res.error) || "The test call failed.",
      });
    });
  };

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
          Provider
        </span>
        <select
          className={selectClass}
          value={current}
          disabled={pending}
          onChange={(e) => changeProvider(e.target.value)}
        >
          {GROUPS.map(({ label, group }) => (
            <optgroup key={group} label={label}>
              {Object.values(PROVIDERS)
                .filter((p) => p.group === group)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        {def.note && <span className="text-[12px] text-faint">{def.note}</span>}
        {def.structured !== "strict" && def.structured !== "native" && (
          <span className="text-[12px] text-faint">
            This provider can&apos;t be strictly held to a schema — smaller models
            may fail on the planner. Ask usually still works.
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
          Model
        </span>
        {custom ? (
          <div className="flex gap-2">
            <Input
              value={draftModel}
              disabled={pending}
              placeholder={def.defaultModel}
              onChange={(e) => setDraftModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveModel(draftModel);
              }}
              className="font-mono"
            />
            <Button onClick={() => saveModel(draftModel)} disabled={pending}>
              Save
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setCustom(false);
                saveModel("");
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <select
            className={selectClass}
            value={model ?? ""}
            disabled={pending}
            onChange={(e) => {
              if (e.target.value === "__custom__") {
                setCustom(true);
                setDraftModel(model ?? "");
                return;
              }
              saveModel(e.target.value);
            }}
          >
            <option value="">{def.defaultModel} (default)</option>
            {def.models
              .filter((m) => m !== def.defaultModel)
              .map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            <option value="__custom__">Custom…</option>
          </select>
        )}
        <span className="text-[12px] text-faint">
          Model names change often — pick Custom to type one that isn&apos;t listed.
        </span>
      </label>

      {keyRequired && (
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            API key
          </span>
          {configured && !editingKey ? (
            <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-background/40 px-3 py-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-habits/10 text-habits">
                <Check className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">{def.label} key configured</p>
                <p className="font-mono text-[12px] text-faint">••••{last4}</p>
              </div>
              <Button variant="outline" onClick={() => setEditingKey(true)}>
                Replace
              </Button>
              <DeleteButton onClick={removeKey} label="Remove API key" size="md" />
            </div>
          ) : (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint2" />
                <Input
                  type="password"
                  autoComplete="off"
                  value={draftKey}
                  disabled={pending}
                  onChange={(e) => setDraftKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && draftKey.trim()) saveKey();
                  }}
                  placeholder={def.keyHint}
                  className="pl-8 font-mono"
                />
              </div>
              <Button onClick={saveKey} disabled={pending || !draftKey.trim()}>
                Save
              </Button>
              {configured && editingKey && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditingKey(false);
                    setDraftKey("");
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}
          <span className="text-[12px] text-faint">
            Encrypted before storage and never shown again.
            {def.docsUrl && (
              <>
                {" "}
                Get one from the{" "}
                <a
                  href={def.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-ink"
                >
                  {def.label} console
                </a>
                .
              </>
            )}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={test} disabled={pending}>
          <Plug className="mr-1.5 h-3.5 w-3.5" />
          Test connection
        </Button>
        {testResult && (
          <span
            className={
              testResult.ok
                ? "text-[12px] text-habits"
                : "text-[12px] text-tasks"
            }
          >
            {testResult.text}
          </span>
        )}
      </div>
    </div>
  );
}
