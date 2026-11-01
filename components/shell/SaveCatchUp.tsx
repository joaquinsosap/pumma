"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { serverAnswers, useLostConnectionToast } from "@/lib/lost-connection";
import { urlMark, watchSaves } from "@/lib/save-catch-up";

const QUIET_MS = 250;

/** Renders nothing. Keeps lists right when the address moves during a save, and tells you when a save with no handler of its own loses the connection. */
export function SaveCatchUp() {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const askedAt = useRef<string | null>(null);

  const refresh = useCallback(() => {
    askedAt.current = urlMark();
    startRefresh(() => router.refresh());
  }, [router]);

  // On the next task, so Next's history patch, in an effect above this one, is already on.
  useEffect(() => {
    const timer = window.setTimeout(() => watchSaves(refresh), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // A refresh is thrown away with nothing in its place when the address moves during it, so ask again once the address is still.
  useEffect(() => {
    if (refreshing || askedAt.current === null) return;
    let seen = urlMark();
    if (askedAt.current === seen) {
      askedAt.current = null;
      return;
    }
    const timer = window.setInterval(() => {
      const now = urlMark();
      if (now !== seen) {
        seen = now;
        return;
      }
      window.clearInterval(timer);
      void serverAnswers().then((up) => {
        if (up) refresh();
      });
    }, QUIET_MS);
    return () => window.clearInterval(timer);
  }, [refreshing, refresh]);

  useLostConnectionToast();
  return null;
}
