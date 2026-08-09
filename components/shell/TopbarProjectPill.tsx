"use client";

import { X } from "@/components/icons";

type Props = {
  title: string;
  color: string;
  onClear?: () => void;
};

export function TopbarProjectPill({ title, color, onClear }: Props) {
  return (
    <span className="inline-flex max-w-[min(220px,40vw)] items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink shadow-sm">
      <span
        className="h-[9px] w-[9px] shrink-0 rounded-[2px]"
        style={{ background: color }}
      />
      <span className="min-w-0 truncate">{title}</span>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="ml-0.5 shrink-0 rounded p-0.5 text-faint transition-colors hover:bg-hover hover:text-ink"
          aria-label="Clear project filter"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}
