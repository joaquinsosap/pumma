"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Download, Share, X } from "@/components/icons";
import { useInstall } from "@/components/pwa/use-install";
import { updateSettingsAction } from "@/lib/actions/settings";
import { isTutorialActive } from "@/lib/tutorial-lock";

/**
 * "Add PUMMA to your home screen", once, at a moment that is not the door.
 *
 * The case for asking at all: a life OS you open every day is a bad fit for a
 * browser tab, and on iPhone installing is the only way reminders can exist,
 * so somebody who never installs simply never finds out notifications were on
 * offer.
 *
 * The case for asking gently, which is what this does:
 *
 *   - Not on arrival. It waits until the app has been open a while, so it
 *     lands on somebody using PUMMA rather than somebody still looking at it.
 *   - Once, ever. Both buttons mark it, including the close — an offer that
 *     returns until you accept is a nag.
 *   - Never when it cannot work: already installed, no install route, or a
 *     browser with nothing to offer.
 *   - Never over the tutorial, which is busy asking for the same attention.
 */
const APPEAR_AFTER_MS = 45_000;

export function InstallNudge({ offered }: { offered: boolean }) {
  const { route, installed } = useInstall();
  const [show, setShow] = useState(false);
  const [, start] = useTransition();

  useEffect(() => {
    if (offered || installed || route === "none") return;
    const timer = window.setTimeout(() => {
      // Re-checked at fire time, not just at mount: the tutorial may have
      // started since, and forty-five seconds is long enough for the state to
      // have moved on.
      if (isTutorialActive()) return;
      setShow(true);
    }, APPEAR_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [offered, installed, route]);

  const dismiss = () => {
    setShow(false);
    start(async () => {
      await updateSettingsAction({ installOffered: true });
    });
  };

  if (!show) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[185] flex justify-center px-3 sm:bottom-6 sm:left-auto sm:right-6 sm:justify-end sm:px-0">
      <div className="pumma-floating pointer-events-auto flex max-w-[min(100%,380px)] animate-pumma-rise items-center gap-2.5 rounded-xl border border-border px-3 py-2.5 shadow-[0_6px_20px_var(--shadow)]">
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/[0.12] text-primary"
        >
          {route === "ios-instructions" ? (
            <Share className="h-3.5 w-3.5" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[12.5px] font-semibold text-ink">
            Put PUMMA on your home screen
          </p>
          <p className="m-0 font-mono text-[10px] leading-relaxed text-faint">
            {route === "ios-instructions"
              ? "Its own icon, full screen, and reminders."
              : "Its own window, no browser in the way."}
          </p>
        </div>
        <Link
          href="/settings#install"
          onClick={dismiss}
          className="shrink-0 rounded-lg border border-ink bg-ink px-2.5 py-1.5 text-[11.5px] font-bold text-background"
        >
          How
        </Link>
        <button
          type="button"
          aria-label="Not now"
          onClick={dismiss}
          className="shrink-0 text-faint2 transition-colors hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
