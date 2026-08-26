"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  isIosSafari,
  isStandalone,
  type InstallPromptEvent,
  type InstallRoute,
} from "@/lib/pwa";

/**
 * Whether PUMMA can be installed here, and how.
 *
 * The `beforeinstallprompt` event fires ONCE, early, and if it is not
 * captured it is gone for that page load. So this listens from mount and
 * holds onto it, which is what lets an install button exist anywhere other
 * than in that event handler.
 */
export function useInstall(): {
  route: InstallRoute;
  installed: boolean;
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
} {
  const deferred = useRef<InstallPromptEvent | null>(null);
  const [route, setRoute] = useState<InstallRoute>("none");
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return;
    }
    if (isIosSafari()) setRoute("ios-instructions");

    const onBefore = (e: Event) => {
      // Chromium shows its own bar otherwise, at a moment of its choosing.
      e.preventDefault();
      deferred.current = e as InstallPromptEvent;
      setRoute("prompt");
    };
    const onInstalled = () => {
      setInstalled(true);
      setRoute("none");
      deferred.current = null;
    };

    window.addEventListener("beforeinstallprompt", onBefore);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    const e = deferred.current;
    if (!e) return "unavailable" as const;
    await e.prompt();
    const { outcome } = await e.userChoice;
    // Spent either way: the event cannot be replayed, and Chromium will fire
    // a fresh one on a later visit if the answer was no.
    deferred.current = null;
    setRoute("none");
    return outcome;
  }, []);

  return { route, installed, install };
}
