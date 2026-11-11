"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

const MESSAGE = "Could not save that. Check your connection.";
const WAITING = "No connection. Waiting for it to come back.";
const FIRST_ASK_MS = 1000;
const ASK_AGAIN_MS = 3000;

/** A page was put back after a lost connection and nothing has answered since. */
let putBackUnanswered = false;
let back: Promise<void> | null = null;

/** What a browser throws when a request never got an answer, or lost it part way: Chrome, Safari, Firefox. */
export function isLostConnection(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    /failed to fetch|load failed|network ?error/i.test(err.message)
  );
}

/** A proxy answering for an app that is restarting or gone. */
export function isProxyAnswer(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

/** What a save or a page throws when a proxy answered for the app: the same as no answer. */
export function noAnswer(): TypeError {
  return new TypeError("Failed to fetch");
}

/** An error screen put its page back. */
export function pagePutBack() {
  putBackUnanswered = true;
}

/** Something the app sent was answered by the app. */
export function serverAnswered() {
  putBackUnanswered = false;
}

/** Ask before a refresh nobody clicked for. Asks for the database too: a page drawn without it is an error screen, and unsaved text goes with the page it replaces. */
export async function serverAnswers(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    const up = (await fetch("/api/health?ready=1", { cache: "no-store" })).ok;
    if (up) serverAnswered();
    return up;
  } catch {
    return false;
  }
}

/** Settles once the server answers again. One poll however many are waiting, and one notice while they do. */
export function whenServerAnswers(): Promise<void> {
  back ??= new Promise<void>((resolve) => {
    toast.loading(WAITING, { id: WAITING });
    const ask = async () => {
      if (!(await serverAnswers())) {
        window.setTimeout(ask, ASK_AGAIN_MS);
        return;
      }
      back = null;
      toast.dismiss(WAITING);
      resolve();
    };
    window.setTimeout(ask, FIRST_ASK_MS);
  });
  return back;
}

/** One toast however many saves fail together. */
export function toastLostConnection() {
  toast.error(MESSAGE, { id: MESSAGE });
}

/** A save with no handler of its own, outside a transition, fails with nobody told. Anything that asks in the background catches its own failure, so what reaches here is a save. */
export function useLostConnectionToast() {
  useEffect(() => {
    const onRejected = (e: PromiseRejectionEvent) => {
      if (isLostConnection(e.reason)) toastLostConnection();
    };
    window.addEventListener("unhandledrejection", onRejected);
    return () => window.removeEventListener("unhandledrejection", onRejected);
  }, []);
}

/** What an error screen does about a lost connection: nothing, put the page straight back, or wait for the server. */
export type Recovery = "none" | "now" | "waiting";

/** The first lost connection puts the page back at once: a save failed, the page is fine. One more before anything answered is a page that can't load, and that waits. */
export function recoveryFor(error: unknown): Recovery {
  if (!isLostConnection(error)) return "none";
  return putBackUnanswered ? "waiting" : "now";
}

/** For an error screen. A save failing in a transition lands there and takes the page with it, so a lost connection puts the page back, at once or when the server answers. */
export function useLostConnectionRecovery(
  error: unknown,
  reset: () => void,
): Recovery {
  const [how] = useState(() => recoveryFor(error));
  useEffect(() => {
    if (how === "none") return;
    if (how === "now") {
      pagePutBack();
      reset();
      // After the reset: the root error screen has no toaster until the app is back.
      window.setTimeout(toastLostConnection, 200);
      return;
    }
    let live = true;
    void whenServerAnswers().then(() => {
      if (live) reset();
    });
    return () => {
      live = false;
    };
  }, [how, reset]);
  return how;
}
