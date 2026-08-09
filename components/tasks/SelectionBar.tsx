"use client";

import { CheckSquare, SlidersHorizontal, X } from "@/components/icons";

/**
 * The phone's selection HUD, floating just above the dock.
 *
 * On a phone the bulk panel is a bottom sheet, and a sheet that opened the
 * moment you picked one task would cover the very rows you still want to pick.
 * So selection stays quiet: this bar reports the count and gets out of the
 * way, the row checkboxes keep working behind it, and the sheet only appears
 * when you ask for it.
 */
export function SelectionBar({
  count,
  onEdit,
  onClear,
}: {
  count: number;
  onEdit: () => void;
  onClear: () => void;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[45] flex justify-center px-3 lg:hidden"
      style={{ bottom: "calc(5.25rem + env(safe-area-inset-bottom))" }}
    >
      <div className="animate-pumma-bloom pointer-events-auto flex w-full max-w-[440px] items-center gap-2 rounded-2xl border border-border bg-surface/95 p-2 pl-3.5 shadow-[0_12px_36px_rgba(0,0,0,0.24)] backdrop-blur-xl">
        <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 text-[13px] font-semibold text-ink">
          {count} selected
        </span>
        <button
          type="button"
          onClick={onEdit}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-[12.5px] font-bold text-background active:scale-95"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Edit
        </button>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-faint active:scale-95"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
