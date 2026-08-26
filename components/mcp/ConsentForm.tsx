"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

interface ScopeRow {
  id: string;
  title: string;
  detail: string;
}

/**
 * The approve/deny half of the consent screen.
 *
 * Deliberately plain. A consent screen is one of the few places where making
 * the safe path fractionally harder is correct: no pre-ticked boxes, no
 * primary-styled Allow next to a greyed Cancel, and the delete permission
 * called out rather than folded into a list where it reads like the others.
 */
export function ConsentForm({
  clientName,
  clientHost,
  redirectUri,
  redirectHost,
  loopback,
  scopes,
  oauthQuery,
  isDemo,
  userEmail,
}: {
  clientId: string;
  clientName: string;
  clientHost: string | null;
  redirectUri: string;
  redirectHost: string | null;
  loopback: boolean;
  scopes: ScopeRow[];
  oauthQuery: string;
  isDemo: boolean;
  userEmail: string | null;
}) {
  const [pending, setPending] = useState<"accept" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (accept: boolean) => {
    if (pending) return;
    setPending(accept ? "accept" : "deny");
    setError(null);
    try {
      const res = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Same-origin so the session cookie rides along; the signed query is
        // what proves this is the request the page actually displayed.
        credentials: "same-origin",
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      });
      const data = (await res.json()) as {
        url?: string;
        redirect_uri?: string;
        message?: string;
      };
      // `url` is what the endpoint actually returns. Its OpenAPI description
      // documents `redirect_uri`, which is read as a fallback rather than
      // trusted: taking the documented name alone meant every Allow click
      // failed with "could not complete that", and the mistake was invisible
      // until a real authorization ran end to end.
      const target = data.url ?? data.redirect_uri;
      if (!res.ok || !target) {
        setError(data.message ?? "Could not complete that. Try connecting again.");
        setPending(null);
        return;
      }
      // Full navigation: the destination belongs to the client, not to us.
      window.location.href = target;
    } catch {
      setError("Could not reach PUMMA. Try again.");
      setPending(null);
    }
  };

  const dangerous = scopes.some((s) => s.id === "pumma:delete");

  if (isDemo) {
    return (
      <div className="rounded-[14px] border-2 border-ink bg-surface p-5 shadow-[3px_3px_0_var(--shadow)]">
        <h1 className="mb-2 text-lg font-extrabold tracking-tight">
          Demo accounts cannot connect apps
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          This demo deletes itself in a few hours, and a connection would
          outlive it. Create a real account to connect{" "}
          <span className="font-semibold text-ink">{clientName}</span>.
        </p>
        <a
          href="/register"
          className="mt-4 inline-flex w-full items-center justify-center rounded-[10px] border-2 border-ink bg-ink px-4 py-2.5 text-sm font-bold text-background no-underline"
        >
          Create an account
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border-2 border-ink bg-surface p-5 shadow-[3px_3px_0_var(--shadow)]">
      <h1 className="text-lg font-extrabold leading-snug tracking-tight">
        Let <span className="underline decoration-2">{clientName}</span> use
        your PUMMA?
      </h1>
      {clientHost && (
        <p className="mt-1 font-mono text-[11px] text-faint2">{clientHost}</p>
      )}
      {userEmail && (
        <p className="mt-2 text-xs text-muted">
          Signed in as <span className="font-semibold text-ink">{userEmail}</span>
        </p>
      )}

      <ul className="mt-4 space-y-2.5 border-t border-border2 pt-4">
        {scopes.map((s) => (
          <li key={s.id} className="flex gap-2.5">
            <span
              aria-hidden="true"
              className={cn(
                "mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full",
                s.id === "pumma:delete" ? "bg-tasks" : "bg-primary",
              )}
            />
            <div className="min-w-0">
              <p
                className={cn(
                  "text-sm font-bold leading-tight",
                  s.id === "pumma:delete" && "text-tasks",
                )}
              >
                {s.title}
              </p>
              {s.detail && (
                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                  {s.detail}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      {dangerous && (
        <p className="mt-4 rounded-[10px] border border-tasks/40 bg-tasks/5 px-3 py-2 text-xs leading-relaxed text-muted">
          Deleting is switched off for your account by default. Approving this
          does not switch it on: you would still have to enable it yourself in
          Settings, Connections.
        </p>
      )}

      {/* Shown because the code goes here, and a name can claim anything. */}
      <div className="mt-4 border-t border-border2 pt-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-faint2">
          Sends you back to
        </p>
        <p className="mt-1 break-all font-mono text-[11px] text-muted">
          {redirectUri || "(not provided)"}
        </p>
        {loopback && (
          <p className="mt-2 text-xs leading-relaxed text-muted">
            This returns to a program on{" "}
            <span className="font-semibold text-ink">
              {redirectHost ?? "this computer"}
            </span>
            . PUMMA cannot verify which one, so only continue if you just
            started connecting from it.
          </p>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-[10px] border border-tasks/40 bg-tasks/5 px-3 py-2 text-xs text-tasks">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => decide(true)}
          disabled={pending !== null}
          className="w-full rounded-[10px] border-2 border-ink bg-ink px-4 py-2.5 text-sm font-bold text-background transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {pending === "accept" ? "Connecting..." : `Allow ${clientName}`}
        </button>
        <button
          type="button"
          onClick={() => decide(false)}
          disabled={pending !== null}
          className="w-full rounded-[10px] border-2 border-ink bg-surface px-4 py-2.5 text-sm font-bold text-ink transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {pending === "deny" ? "Cancelling..." : "Cancel"}
        </button>
      </div>

      <p className="mt-3 text-center text-[11px] leading-relaxed text-faint2">
        You can disconnect this at any time in Settings, Connections.
      </p>
    </div>
  );
}
