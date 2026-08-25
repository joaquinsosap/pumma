"use client";

import type { TaskPriority } from "@/lib/types";
import {
  PRIORITY_COLOR,
  PRIORITY_INK,
  PRIORITY_GLYPH,
} from "@/components/tasks/PriorityChip";
import { cn } from "@/lib/utils";

const OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "high", label: "High" },
  { value: "med", label: "Mid" },
  { value: "low", label: "Low" },
];

/**
 * Priority for the task about to be captured. Same three levels, same arrows
 * and colours as the rows it will end up in, so the choice made here is
 * recognisable there.
 *
 * Hidden by the capture bar when the text already carries a "!high" token —
 * the same way the date picker steps aside once you've typed a date.
 */
export function PriorityQuickPick({
  value,
  onChange,
  disabled,
}: {
  value: TaskPriority;
  onChange: (next: TaskPriority) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-1"
      role="radiogroup"
      aria-label="Priority"
    >
      {OPTIONS.map(({ value: v, label }) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(v)}
            title={`${label} priority`}
            className={cn(
              "flex items-center gap-1 rounded-lg border px-1.5 py-1 font-mono text-[11px] transition-all disabled:pointer-events-none disabled:opacity-50",
              active
                ? "font-bold shadow-[2px_2px_0_var(--shadow)]"
                : "border-border bg-surface font-medium text-muted hover:border-faint hover:bg-surface2",
            )}
            style={
              active
                ? {
                    borderColor: PRIORITY_COLOR[v],
                    background: `color-mix(in oklab, ${PRIORITY_COLOR[v]} 14%, transparent)`,
                    color: PRIORITY_INK[v],
                  }
                : undefined
            }
          >
            <span
              aria-hidden
              className="w-2.5 shrink-0 text-center text-[14px] font-bold leading-[11px]"
              style={active ? undefined : { color: PRIORITY_INK[v] }}
            >
              {PRIORITY_GLYPH[v]}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}
