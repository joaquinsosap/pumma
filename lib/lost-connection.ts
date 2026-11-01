"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

const MESSAGE = "Could not save that. Check your connection.";
const RETRY_GAP_MS = 1000;

let lastRecovery = 0;

/** What a browser throws when a request never got an answer: Chrome, Safari, Firefox. */
export function isLostConnection(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    /failed to fetch|load failed|networkerror/i.test(err.message)
  );
}

/** Ask before a refresh nobody clicked for. With no answer Next leaves the page for the browser's error screen, and unsaved text goes with it. */
export async function serverAnswers(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    return (await fetch("/api/health", { cache: "no-store" })).ok;
  } catch {
    return false;
  }
}

/** One toast however many saves fail together. */
export function toastLostConnection() {
  toast.error(MESSAGE, { id: MESSAGE });
}

/** A save with no handler of its own, outside a transition, fails with nobody told. */
export function useLostConnectionToast() {
  useEffect(() => {
    const onRejected = (e: PromiseRejectionEvent) => {
      // A poll in the background failing offline isn't something you did.
      if (isLostConnection(e.reason) && navigator.userActivation?.isActive !== false) {
        toastLostConnection();
      }
    };
    window.addEventListener("unhandledrejection", onRejected);
    return () => window.removeEventListener("unhandledrejection", onRejected);
  }, []);
}

/** For an error screen. A save failing in a transition lands there and takes the page with it, so a lost connection puts the page straight back. True while that happens. Again within a second is no second save, it's a page that can't load offline, and that shows the screen. */
export function useLostConnectionRecovery(
  error: unknown,
  reset: () => void,
): boolean {
  const [recovering] = useState(
    () => isLostConnection(error) && Date.now() - lastRecovery >= RETRY_GAP_MS,
  );
  useEffect(() => {
    if (!recovering) return;
    lastRecovery = Date.now();
    reset();
    // After the reset: the root error screen has no toaster until the app is back.
    window.setTimeout(toastLostConnection, 200);
  }, [recovering, reset]);
  return recovering;
}
