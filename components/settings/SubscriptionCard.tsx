"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// Rendered only on hosted deployments (see settings/page.tsx). The billing
// service — a separate container behind the same domain — owns this endpoint;
// the app just displays whatever it returns and links out to the provider's
// manage page. Card data never touches this app.
type Summary = {
  subscribed: boolean;
  status?: string;
  since?: string | null;
  recurrence?: string | null;
  licenseKey?: string | null;
  lastPayment?: {
    date: string | null;
    amount: string | null;
    cardVisual: string | null;
    cardType: string | null;
  } | null;
  manageUrl?: string;
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-habits/15 text-habits border-habits/40",
  trialing: "bg-primary/10 text-primary border-primary/40",
  past_due: "bg-amber-500/15 text-amber-600 border-amber-500/40",
  canceled: "bg-tasks/10 text-tasks border-tasks/40",
};

function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function SubscriptionCard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/billing/summary", { cache: "no-store" })
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      )
      .then((data) => alive && setSummary(data))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed) {
    return (
      <p className="text-[12px] text-faint">
        Billing details are unavailable right now. Try again in a minute.
      </p>
    );
  }
  if (!summary) {
    return (
      <div className="h-20 animate-pulse rounded-lg border border-border/70 bg-background/40" />
    );
  }
  if (!summary.subscribed) {
    return (
      <p className="text-sm text-muted">
        No active subscription on this account.{" "}
        <a
          href="/billing"
          className="font-semibold text-ink underline underline-offset-2"
        >
          Subscribe
        </a>
      </p>
    );
  }

  const paid = summary.lastPayment;
  const card = paid?.cardVisual
    ? `${paid.cardType ? paid.cardType.toUpperCase() + " " : ""}${paid.cardVisual}`
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold lowercase",
            STATUS_STYLES[summary.status ?? ""] ?? "border-border text-muted",
          )}
        >
          {summary.status ?? "unknown"}
        </span>
        {summary.recurrence && (
          <span className="text-sm text-ink">Billed {summary.recurrence}</span>
        )}
        {fmtDate(summary.since) && (
          <span className="text-[12px] text-faint">
            · member since {fmtDate(summary.since)}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-background/40 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
            Last payment
          </p>
          <p className="mt-1 text-sm text-ink">
            {paid?.amount ?? "—"}
            {fmtDate(paid?.date) && (
              <span className="text-muted"> on {fmtDate(paid?.date)}</span>
            )}
          </p>
          <p className="mt-0.5 text-[12px] text-faint">
            {card ?? "Card details appear after your next charge."}
          </p>
        </div>
        <div className="rounded-lg border border-border/70 bg-background/40 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
            License key
          </p>
          <p className="mt-1 break-all font-mono text-[12px] text-ink">
            {summary.licenseKey ?? "—"}
          </p>
        </div>
      </div>

      {summary.manageUrl && (
        <div>
          <a
            href={summary.manageUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block rounded-lg bg-ink px-4 py-1.5 text-[12px] font-bold text-background"
          >
            Manage billing →
          </a>
          <p className="mt-1.5 text-[12px] text-faint">
            Opens your payment provider&apos;s manage page, where you can update
            your card, switch plans, or cancel there. Changes sync back
            automatically.
          </p>
        </div>
      )}
    </div>
  );
}
