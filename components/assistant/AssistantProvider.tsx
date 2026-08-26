"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { AssistOutcome } from "@/lib/ai/assist";
import type { AssistantMode } from "@/lib/ai/assistant-schema";

type Status = "idle" | "pending" | "ready" | "error";

type AssistantState = {
  status: Status;
  outcome: AssistOutcome | null;
  error: string | null;
  intent: string | null;
  /** The pin used for the in-flight/last call — "auto" unless the user corrected. */
  mode: AssistantMode;
};

type AssistantContextValue = AssistantState & {
  run: (text: string, mode?: AssistantMode) => void;
  /**
   * Replace the outcome in place, without another model call.
   *
   * How the scope screen hands over: it drafts a changeset from the criteria
   * the user confirmed and swaps it in. Nothing is re-generated, so what the
   * preview showed is exactly what the canvas gets.
   */
  setOutcome: (outcome: AssistOutcome) => void;
  /** Re-run the last intent pinned to the other branch ("I meant to…"). */
  flipMode: () => void;
  clear: () => void;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

const IDLE: AssistantState = {
  status: "idle",
  outcome: null,
  error: null,
  intent: null,
  mode: "auto",
};

/**
 * Holds the assistant's transient state so the omnibar (app layout) can
 * trigger it and the /assistant page renders it. In-memory only; a draft dies
 * with the tab, which is the deliberate persistence story.
 *
 * The call goes through /api/assistant with fetch, NOT a server action:
 * actions serialize per client and hold navigations behind the one in flight,
 * which froze the entire app for the length of the AI call. fetch leaves the
 * router (and every other action) free while the assistant thinks.
 */
export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AssistantState>(IDLE);

  const setOutcome = useCallback((outcome: AssistOutcome) => {
    setState((s) => ({ ...s, status: "ready", outcome, error: null }));
  }, []);

  const run = useCallback((text: string, mode: AssistantMode = "auto") => {
    setState({ ...IDLE, status: "pending", intent: text, mode });
    void (async () => {
      let outcome: AssistOutcome | null = null;
      let error: string | null = null;
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, mode }),
        });
        const json = (await res.json()) as
          | { ok: true; data: AssistOutcome }
          | { ok: false; error: string };
        if (json.ok) outcome = json.data;
        else error = json.error;
      } catch {
        error =
          "Couldn't reach the assistant. Check your connection and try again.";
      }
      // Only the newest request may write; a superseded one falls through.
      setState((s) =>
        s.intent === text && s.mode === mode && s.status === "pending"
          ? outcome
            ? { ...s, status: "ready", outcome }
            : { ...s, status: "error", error }
          : s,
      );
    })();
  }, []);

  const flipMode = useCallback(() => {
    setState((s) => {
      if (!s.intent || !s.outcome) return s;
      const next: AssistantMode =
        s.outcome.kind === "answer" ? "changeset" : "answer";
      // run() from inside an updater would double-fire; schedule after.
      const intent = s.intent;
      queueMicrotask(() => run(intent, next));
      return s;
    });
  }, [run]);

  const clear = useCallback(() => setState(IDLE), []);

  return (
    <AssistantContext.Provider value={{ ...state, run, setOutcome, flipMode, clear }}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant(): AssistantContextValue {
  const v = useContext(AssistantContext);
  if (!v) throw new Error("useAssistant must be used within AssistantProvider");
  return v;
}
