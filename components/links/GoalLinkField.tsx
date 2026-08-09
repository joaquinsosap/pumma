"use client";

import { X } from "@/components/icons";
import type { Goal } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const chipClass =
  "inline-flex items-center gap-2 rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-xs text-muted";
const selectClass =
  "cursor-pointer rounded-lg border border-border bg-surface px-3 py-2 text-xs text-muted outline-none transition-colors hover:border-faint2 focus:border-faint2 focus:ring-2 focus:ring-ink/10";
const addSelectClass =
  "cursor-pointer rounded-lg border border-dashed border-border bg-transparent px-3 py-2 text-xs text-faint outline-none transition-colors hover:border-faint2 hover:text-muted focus:border-faint2";

function RemoveButton({
  onClick,
  title,
}: {
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mr-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint2 transition-colors hover:bg-hover hover:text-ink"
      title={title}
      aria-label={title}
    >
      <X className="h-3.5 w-3.5" strokeWidth={2.5} />
    </button>
  );
}

function LinkDot({
  color,
  shape = "square",
}: {
  color?: string;
  shape?: "square" | "circle" | "diamond";
}) {
  return (
    <span
      className={cn(
        "h-2 w-2 shrink-0",
        shape === "square" && "rounded-[2px]",
        shape === "circle" && "rounded-full",
        shape === "diamond" && "rotate-45"
      )}
      style={{ background: color ?? "var(--faint)" }}
    />
  );
}

type Props = {
  goals: Goal[];
  value: string | null;
  onChange: (goalId: string | null) => void;
  className?: string;
};

export function GoalLinkField({ goals, value, onChange, className }: Props) {
  const linked = goals.find((g) => g.id === value);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {linked ? (
        <span className={chipClass}>
          <LinkDot color="var(--goals)" shape="diamond" />
          <span className="max-w-[180px] truncate font-medium">{linked.title}</span>
          <RemoveButton
            onClick={() => onChange(null)}
            title="Remove goal link"
          />
        </span>
      ) : (
        <select
          value=""
          onChange={(e) => {
            const next = e.target.value;
            if (next) onChange(next);
          }}
          className={selectClass}
        >
          <option value="">Link goal…</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

type MultiLinkProps = {
  label: string;
  items: { id: string; title: string; color?: string }[];
  available: { id: string; title: string }[];
  onAttach: (id: string) => void;
  onDetach: (id: string) => void;
  dotShape?: "square" | "circle" | "diamond";
};

export function GoalMultiLinkField({
  label,
  items,
  available,
  onAttach,
  onDetach,
  dotShape = "square",
}: MultiLinkProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-full font-mono text-[10px] font-semibold uppercase tracking-wide text-faint2 sm:w-auto">
        {label}
      </span>
      {items.map((item) => (
        <span key={item.id} className={chipClass}>
          <LinkDot color={item.color} shape={dotShape} />
          <span className="max-w-[140px] truncate font-medium">{item.title}</span>
          <RemoveButton
            onClick={() => onDetach(item.id)}
            title={`Remove ${label.toLowerCase()}`}
          />
        </span>
      ))}
      {available.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            const id = e.target.value;
            if (id) onAttach(id);
          }}
          className={addSelectClass}
        >
          <option value="">+ Add {label.toLowerCase()}</option>
          {available.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
