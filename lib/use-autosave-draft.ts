"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  committedRequired,
  draftFrom,
  fromServer,
  landed,
  reverted,
  send,
  sendFailed,
  typed,
  type DraftState,
} from "@/lib/draft-state";
import { useTrySave } from "@/lib/use-try-save";

type Save = (
  entityKey: string,
  value: string,
) => void | Promise<{ ok: boolean; error?: string } | void>;

/**
 * A text field that saves only what you typed, and never loses it.
 *
 * Debounced saves alone are a data-loss trap: the timer lives in an effect, so
 * closing the editor (or switching to another record) cancels it and the text
 * goes with it. This commits what was typed:
 *   • after `delay` ms of no typing (never, when `delay` is null),
 *   • on blur (via the returned `flush`),
 *   • when the record changes or the component unmounts.
 *
 * Nothing but typing can make it save, so an open panel can't write its old copy
 * over newer text. The server's value shows as soon as it changes, unless
 * unsaved typing is in the box. The rules are in lib/draft-state.ts.
 *
 * `required` is for titles: a blank box is never sent and goes back to what is
 * stored when you leave it.
 *
 * Returns [draft, setDraft, flush, cancel].
 */
export function useAutosaveDraft(
  serverValue: string,
  entityKey: string,
  save: Save,
  {
    delay = 500,
    required = false,
  }: { delay?: number | null; required?: boolean } = {},
): [string, (value: string) => void, () => void, () => void] {
  const [shown, setShown] = useState(serverValue);
  const stateRef = useRef(draftFrom(serverValue));
  // Moves on only after the outgoing record's flush, so that text goes to the record it was typed into.
  const keyRef = useRef(entityKey);
  const timerRef = useRef<number | undefined>(undefined);
  const attempt = useTrySave();

  // Keep the latest save fn without restarting anything (callers usually pass an inline closure).
  const saveRef = useRef(save);
  saveRef.current = save;

  const apply = useCallback((next: DraftState) => {
    stateRef.current = next;
    setShown(next.shown);
  }, []);

  const sendNow = useCallback(() => {
    if (required && !stateRef.current.shown.trim()) return;
    const out = send(stateRef.current);
    if (!out) return;
    stateRef.current = out.state;
    const key = keyRef.current;
    void attempt(
      () => saveRef.current(key, out.value),
      () => {
        if (keyRef.current === key) apply(sendFailed(stateRef.current, out.value));
      },
    ).then((res) => {
      if (res !== null && keyRef.current === key) {
        stateRef.current = landed(stateRef.current, out.value);
      }
    });
  }, [apply, attempt, required]);

  const flush = useCallback(() => {
    window.clearTimeout(timerRef.current);
    if (required) apply(committedRequired(stateRef.current));
    sendNow();
  }, [apply, required, sendNow]);

  const setDraft = useCallback(
    (value: string) => {
      window.clearTimeout(timerRef.current);
      apply(typed(stateRef.current, value));
      if (delay !== null && stateRef.current.unsaved) {
        timerRef.current = window.setTimeout(sendNow, delay);
      }
    },
    [apply, delay, sendNow],
  );

  const cancel = useCallback(() => {
    window.clearTimeout(timerRef.current);
    apply(reverted(stateRef.current));
  }, [apply]);

  useEffect(() => {
    if (keyRef.current === entityKey) {
      apply(fromServer(stateRef.current, serverValue));
      return;
    }
    keyRef.current = entityKey;
    apply(draftFrom(serverValue));
  }, [serverValue, entityKey, apply]);

  // Runs on unmount AND before entityKey changes: commits the outgoing edit.
  useEffect(() => {
    return () => {
      flush();
    };
  }, [entityKey, flush]);

  return [shown, setDraft, flush, cancel];
}
