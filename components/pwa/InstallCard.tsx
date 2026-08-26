"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Download, Share, Smartphone } from "@/components/icons";
import { useInstall } from "@/components/pwa/use-install";
import { cn } from "@/lib/utils";

/**
 * Install PUMMA, explained the way each platform actually works.
 *
 * Not one button with a tooltip: a Chromium browser can be handed a real
 * install dialog, and iOS cannot be handed anything at all. Pretending
 * otherwise produces a button that does nothing on the one platform where
 * installing matters most, since Apple gates web push behind it.
 */
export function InstallCard({ className }: { className?: string }) {
  const { route, installed, install } = useInstall();
  const [busy, setBusy] = useState(false);

  if (installed) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border bg-surface2 px-3 py-2.5",
          className,
        )}
      >
        <Check className="h-3.5 w-3.5 shrink-0 text-habits" strokeWidth={2.5} />
        <span className="text-[12.5px] text-muted">
          Installed. You are running the app version.
        </span>
      </div>
    );
  }

  if (route === "ios-instructions") {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <p className="m-0 text-[12.5px] leading-relaxed text-muted">
          Add PUMMA to your Home Screen for a full-screen app with its own
          icon. On iPhone this is also the only way to get reminders: Apple
          does not allow notifications for a site in a Safari tab.
        </p>
        <ol className="m-0 flex list-none flex-col gap-1 p-0">
          <Step n={1}>
            Tap <Share className="mx-0.5 inline h-3.5 w-3.5 align-[-2px]" />{" "}
            Share, at the bottom of Safari
          </Step>
          <Step n={2}>Scroll to Add to Home Screen</Step>
          <Step n={3}>Open PUMMA from the new icon</Step>
        </ol>
      </div>
    );
  }

  if (route === "prompt") {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <p className="m-0 text-[12.5px] leading-relaxed text-muted">
          Install PUMMA for its own window and icon, with no browser chrome in
          the way.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void install()
              .then((outcome) => {
                if (outcome === "accepted") toast.success("Installing PUMMA");
              })
              .finally(() => setBusy(false));
          }}
          className="flex w-fit items-center gap-1.5 rounded-lg border border-ink bg-ink px-3.5 py-2 text-[12.5px] font-bold text-background transition-colors hover:bg-ink/90 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" />
          Install PUMMA
        </button>
      </div>
    );
  }

  // No API and not iOS Safari: Firefox, an iOS Chrome, a desktop browser that
  // has already declined. Saying where the control lives beats a dead button.
  return (
    <p
      className={cn(
        "m-0 text-[12.5px] leading-relaxed text-muted",
        className,
      )}
    >
      <Smartphone className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-faint2" />
      Your browser installs apps from its own menu — look for Install or Add to
      Home Screen. PUMMA then opens in its own window.
    </p>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-baseline gap-2 text-[12px] leading-relaxed text-muted">
      <span className="shrink-0 font-mono text-[10px] text-faint2">{n}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}
