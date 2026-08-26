"use client";

import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { revokeMcpClientAction } from "@/lib/actions/mcp";
import type { McpAuditRow } from "@/lib/mcp/audit-types";
import type { ConnectedClient } from "@/lib/mcp/connections";

export interface McpPrefs {
  enabled: boolean;
  allowCreate: boolean;
  allowUpdate: boolean;
  allowDelete: boolean;
  serveExternal: boolean;
}

/**
 * The Connections panel.
 *
 * The switches here are the product feature, not a convenience: they are
 * enforced by the server on every request, so turning one off is a refusal
 * rather than an instruction a model may or may not respect. The copy says so
 * plainly, because the whole reason to give someone a delete switch is that
 * they can trust it while a model is holding their credentials.
 *
 * The activity list underneath is the other half of that trust. The first
 * thing anyone sensible does after connecting a tool to their entire life is
 * check what it actually did.
 */
export function McpSettings({
  prefs,
  endpoint,
  onChange,
  activity,
  clients,
}: {
  prefs: McpPrefs;
  /** The URL to paste into a client. */
  endpoint: string;
  onChange: (patch: Partial<McpPrefs>) => void;
  activity: McpAuditRow[];
  clients: ConnectedClient[];
}) {
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(endpoint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused; the field is selectable anyway.
    }
  };

  const off = !prefs.enabled;

  const disconnect = async (clientId: string, name: string) => {
    if (revoking) return;
    // A browser confirm rather than a designed dialog: this is destructive,
    // rare, and the name is the only thing worth reading before deciding.
    if (!window.confirm(`Disconnect ${name}? It will lose access to your PUMMA.`)) {
      return;
    }
    setRevoking(clientId);
    try {
      await revokeMcpClientAction(clientId);
      window.location.reload();
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div>
      <Row
        label="Allow MCP connections"
        description="Lets an AI client you connect read and change your PUMMA. Off until you turn it on."
      >
        <Switch
          checked={prefs.enabled}
          onCheckedChange={(v) => onChange({ enabled: v })}
        />
      </Row>

      {prefs.enabled && (
        <div className="mt-3 rounded-[10px] border border-border bg-well px-3 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-faint2">
            Server URL
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">
              {endpoint}
            </code>
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-[8px] border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-hover"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-faint">
            Add this to your AI client as an MCP server. It will open PUMMA in
            your browser to sign in and ask what to allow.
          </p>
        </div>
      )}

      {/* Kept visible rather than hidden while off, so the shape of what you
          are turning on is knowable before you turn it on. */}
      <div className={cn("mt-4", off && "pointer-events-none opacity-45")}>
        <p className="mb-1 font-mono text-[10px] uppercase tracking-widest text-faint2">
          What connected apps may do
        </p>
        <Row
          label="Create items"
          description="Add tasks, notes, projects, goals, habits and meetings."
        >
          <Switch
            checked={prefs.allowCreate}
            disabled={off}
            onCheckedChange={(v) => onChange({ allowCreate: v })}
          />
        </Row>
        <Row
          label="Edit items"
          description="Change what already exists, including marking things done."
        >
          <Switch
            checked={prefs.allowUpdate}
            disabled={off}
            onCheckedChange={(v) => onChange({ allowUpdate: v })}
          />
        </Row>
        <Row
          label="Delete items"
          description="Off by default. PUMMA refuses every delete while this is off, whatever the app asks for."
          danger
        >
          <Switch
            checked={prefs.allowDelete}
            disabled={off}
            onCheckedChange={(v) => onChange({ allowDelete: v })}
          />
        </Row>
        <Row
          label="Share synced calendars"
          description="Include meetings from calendars you subscribe to. Their text comes from whoever publishes the feed, so it is always labelled as untrusted."
        >
          <Switch
            checked={prefs.serveExternal}
            disabled={off}
            onCheckedChange={(v) => onChange({ serveExternal: v })}
          />
        </Row>
      </div>

      {prefs.enabled && clients.length > 0 && (
        <div className="mt-5 border-t border-border/60 pt-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint2">
            Connected apps
          </p>
          <ul className="space-y-2">
            {clients.map((c) => (
              <li key={c.clientId} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{c.name}</p>
                  <p className="mt-0.5 text-[11px] text-faint">
                    {c.canDelete ? "Can read, edit and delete" : "Can read and edit"}
                    {c.connectedAt
                      ? ` · connected ${new Date(c.connectedAt).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={revoking !== null}
                  onClick={() => disconnect(c.clientId, c.name)}
                  className="shrink-0 rounded-[8px] border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-tasks transition-colors hover:bg-hover disabled:opacity-50"
                >
                  {revoking === c.clientId ? "..." : "Disconnect"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {prefs.enabled && (
        <div className="mt-5 border-t border-border/60 pt-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-faint2">
            Recent activity
          </p>
          {activity.length === 0 ? (
            <p className="text-[12px] text-faint">
              Nothing yet. Anything a connected app does shows up here.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {activity.map((row, i) => (
                <li
                  key={`${row.at}-${i}`}
                  className="flex items-baseline gap-2 text-[12px]"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1 h-[6px] w-[6px] shrink-0 rounded-full",
                      row.ok ? "bg-primary" : "bg-tasks",
                    )}
                  />
                  <span className="font-mono text-ink">{row.tool}</span>
                  <span className="min-w-0 flex-1 truncate text-faint">
                    {row.clientName || row.clientId}
                    {row.ok ? "" : ` - refused (${row.errorCode ?? "error"})`}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-faint2">
                    {shortTime(row.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Local copy of the settings row, so this panel can mark one as dangerous. */
function Row({
  label,
  description,
  danger,
  children,
}: {
  label: string;
  description?: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex max-w-2xl items-center justify-between gap-6 border-b border-border/60 py-3 last:border-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm", danger ? "text-tasks" : "text-ink")}>
          {label}
        </div>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-snug text-faint">
            {description}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** "14:32" today, "26 Aug" before that. Enough to place an event, no more. */
function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
