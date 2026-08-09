"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  min?: number;
  suffix: string;
  hint?: string;
  onSave: (value: number) => void;
};

export function SettingsNumberField({
  value,
  min = 1,
  suffix,
  hint,
  onSave,
}: Props) {
  const [draft, setDraft] = useState(String(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(String(value));
  }, [value]);

  return (
    <label className="block">
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          value={draft}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            focusedRef.current = false;
            const trimmed = draft.trim();
            if (!trimmed) {
              setDraft(String(value));
              return;
            }
            const parsed = Number(trimmed);
            if (!Number.isFinite(parsed) || parsed < min) {
              setDraft(String(value));
              return;
            }
            const next = Math.round(parsed);
            setDraft(String(next));
            if (next !== value) onSave(next);
          }}
        />
        <span className="shrink-0 font-mono text-[11px] text-faint">
          {suffix}
        </span>
      </div>
      {hint ? <p className="mt-1 text-[11px] text-faint">{hint}</p> : null}
    </label>
  );
}
