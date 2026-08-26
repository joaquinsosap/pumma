"use client";

import { SlidersHorizontal, Check, X } from "@/components/icons";
import type { Tag } from "@/lib/schemas";
import type { TaskStatus, TaskPriority } from "@/lib/types";
import {
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_DUE_FILTERS,
  STATUS_LABELS,
  PRIORITY_LABELS,
  DUE_LABELS,
  NO_FILTERS,
  countActiveFilters,
  toggleFilterValue,
  type TaskFilters,
} from "@/lib/task-filters";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const STATUS_DOTS: Record<TaskStatus, string> = {
  todo: "var(--faint2)",
  doing: "var(--primary)",
  done: "oklch(0.65 0.17 150)",
};

const PRIORITY_DOTS: Record<TaskPriority, string> = {
  high: "oklch(0.64 0.18 25)",
  med: "oklch(0.72 0.15 70)",
  low: "var(--prio-low)",
};

export function TaskFilterMenu({
  filters,
  onChange,
  tags,
}: {
  filters: TaskFilters;
  onChange: (next: TaskFilters) => void;
  tags: Tag[];
}) {
  const active = countActiveFilters(filters);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={active ? `Filters, ${active} active` : "Filters"}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold transition-all",
            active
              ? "border-ink bg-ink text-background shadow-[1px_1px_0_var(--shadow)]"
              : "border-border bg-surface2 text-muted hover:bg-hover hover:text-ink",
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2.2} />
          Filter
          {active > 0 && (
            <span className="rounded bg-background/25 px-1.5 font-mono text-[10px] font-bold">
              {active}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        collisionPadding={12}
        className="max-h-[min(65vh,440px)] w-[248px] max-w-[calc(100vw-24px)] overflow-y-auto p-0"
      >
        <div className="flex items-center justify-between border-b border-border2 px-3 py-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            Filter
          </span>
          {active > 0 && (
            <button
              type="button"
              onClick={() => onChange(NO_FILTERS)}
              className="text-[11px] font-semibold text-faint transition-colors hover:text-ink"
            >
              Clear all
            </button>
          )}
        </div>

        <Section label="Status">
          {TASK_STATUSES.map((s) => (
            <Row
              key={s}
              label={STATUS_LABELS[s]}
              dot={STATUS_DOTS[s]}
              checked={filters.status.includes(s)}
              onToggle={() =>
                onChange({
                  ...filters,
                  status: toggleFilterValue(filters.status, s, TASK_STATUSES),
                })
              }
            />
          ))}
        </Section>

        <Section label="Due">
          {/* The one slice the tabs can't make: Today and Upcoming both
              exclude the past by construction. */}
          {TASK_DUE_FILTERS.map((d) => (
            <Row
              key={d}
              label={DUE_LABELS[d]}
              dot={d === "overdue" ? "oklch(0.64 0.18 25)" : "var(--faint2)"}
              checked={(filters.due ?? []).includes(d)}
              onToggle={() =>
                onChange({
                  ...filters,
                  due: toggleFilterValue(
                    filters.due ?? [],
                    d,
                    TASK_DUE_FILTERS,
                  ),
                })
              }
            />
          ))}
        </Section>

        <Section label="Priority">
          {TASK_PRIORITIES.map((p) => (
            <Row
              key={p}
              label={PRIORITY_LABELS[p]}
              dot={PRIORITY_DOTS[p]}
              checked={filters.priority.includes(p)}
              onToggle={() =>
                onChange({
                  ...filters,
                  priority: toggleFilterValue(
                    filters.priority,
                    p,
                    TASK_PRIORITIES,
                  ),
                })
              }
            />
          ))}
        </Section>

        {tags.length > 0 && (
          <Section label="Tags" last>
            {tags.map((tag) => (
              <Row
                key={tag.id}
                label={tag.name}
                dot={tag.color}
                capitalize
                checked={filters.tagIds.includes(tag.id)}
                onToggle={() =>
                  onChange({
                    ...filters,
                    tagIds: toggleFilterValue(
                      filters.tagIds,
                      tag.id,
                      tags.map((t) => t.id),
                    ),
                  })
                }
              />
            ))}
          </Section>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Active filters, spelled out as removable chips. The popover alone would hide
 * why the list looks short — this keeps every narrowing visible and one click
 * from being undone.
 */
export function TaskFilterChips({
  filters,
  onChange,
  tags,
}: {
  filters: TaskFilters;
  onChange: (next: TaskFilters) => void;
  tags: Tag[];
}) {
  if (!countActiveFilters(filters)) return null;

  const tagById = new Map(tags.map((t) => [t.id, t]));

  const chips = [
    ...filters.status.map((s) => ({
      key: `status:${s}`,
      label: STATUS_LABELS[s],
      dot: STATUS_DOTS[s],
      capitalize: false,
      remove: () =>
        onChange({ ...filters, status: filters.status.filter((v) => v !== s) }),
    })),
    ...(filters.due ?? []).map((d) => ({
      key: `due:${d}`,
      label: DUE_LABELS[d],
      dot: d === "overdue" ? "oklch(0.64 0.18 25)" : "var(--faint2)",
      capitalize: false,
      remove: () =>
        onChange({
          ...filters,
          due: (filters.due ?? []).filter((v) => v !== d),
        }),
    })),
    ...filters.priority.map((p) => ({
      key: `priority:${p}`,
      label: `${PRIORITY_LABELS[p]} priority`,
      dot: PRIORITY_DOTS[p],
      capitalize: false,
      remove: () =>
        onChange({
          ...filters,
          priority: filters.priority.filter((v) => v !== p),
        }),
    })),
    ...filters.tagIds.map((id) => ({
      key: `tag:${id}`,
      label: tagById.get(id)?.name ?? "tag",
      dot: tagById.get(id)?.color ?? "var(--faint2)",
      capitalize: true,
      remove: () =>
        onChange({
          ...filters,
          tagIds: filters.tagIds.filter((v) => v !== id),
        }),
    })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5 max-lg:mb-2.5 lg:mb-3">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.remove}
          aria-label={`Remove filter ${chip.label}`}
          className="group flex items-center gap-1.5 rounded-full border border-border bg-surface py-1 pl-2 pr-1.5 text-[11.5px] font-medium text-muted transition-colors hover:border-faint hover:text-ink"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: chip.dot }}
          />
          <span className={cn(chip.capitalize && "capitalize")}>
            {chip.label}
          </span>
          <X className="h-3 w-3 text-faint2 transition-colors group-hover:text-ink" />
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(NO_FILTERS)}
        className="ml-0.5 text-[11.5px] font-semibold text-faint transition-colors hover:text-ink"
      >
        Clear all
      </button>
    </div>
  );
}

function Section({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={cn("px-1.5 py-1.5", !last && "border-b border-border2")}>
      <div className="px-1.5 pb-1 pt-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-widest text-faint2">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  dot,
  checked,
  onToggle,
  capitalize,
}: {
  label: string;
  dot: string;
  checked: boolean;
  onToggle: () => void;
  /** Tag names are stored lowercase; the fixed labels are already cased. */
  capitalize?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-hover",
        checked ? "font-semibold text-ink" : "text-muted",
      )}
    >
      <span
        className={cn(
          "flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-colors",
          checked ? "border-ink bg-ink text-background" : "border-border",
        )}
      >
        {checked && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
      </span>
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: dot }}
      />
      <span className={cn("min-w-0 truncate", capitalize && "capitalize")}>
        {label}
      </span>
    </button>
  );
}
