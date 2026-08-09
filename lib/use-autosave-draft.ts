"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A text field that autosaves without ever losing what you typed.
 *
 * Debounced saves alone are a data-loss trap: the timer lives in an effect, so
 * closing the editor (or switching to another record) cancels it and the text
 * goes with it. This keeps the unsaved value in a ref — tagged with the record
 * it belongs to — and commits it:
 *   • after `delay` ms of no typing,
 *   • on blur (via the returned `flush`),
 *   • when the record changes or the component unmounts.
 *
 * The tag matters: flushing during a switch must write to the record the text
 * was typed into, not the one being opened.
 *
 * Returns [draft, setDraft, flush].
 */
export function useAutosaveDraft(
  serverValue: string,
  entityKey: string,
  save: (entityKey: string, value: string) => void,
  delay = 500,
): [string, (value: string) => void, () => void] {
  const [draft, setDraft] = useState(serverValue);
  const pendingRef = useRef<{ key: string; value: string } | null>(null);

  // Keep the latest save fn without making it an effect dependency (callers
  // usually pass an inline closure, which would restart the debounce).
  const saveRef = useRef(save);
  saveRef.current = save;

  // Adopt the server value when the record changes — not on every refresh,
  // which would clobber what's being typed.
  useEffect(() => {
    setDraft(serverValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKey]);

  const flush = useCallback(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    saveRef.current(pending.key, pending.value);
  }, []);

  useEffect(() => {
    if (draft === serverValue) {
      pendingRef.current = null;
      return;
    }
    pendingRef.current = { key: entityKey, value: draft };
    const handle = window.setTimeout(flush, delay);
    return () => window.clearTimeout(handle);
  }, [draft, serverValue, entityKey, flush, delay]);

  // Runs on unmount AND before entityKey changes — commits the outgoing edit.
  // Declared after the debounce effect so its timer is cleared first.
  useEffect(() => {
    return () => {
      flush();
    };
  }, [entityKey, flush]);

  return [draft, setDraft, flush];
}
