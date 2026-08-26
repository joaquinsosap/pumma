"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check } from "@/components/icons";
import type { Tag } from "@/lib/schemas";
import {
  COUNT_CHOICES,
  FILTERS_FOR,
  SCOPE_ENTITIES,
  SORTS_FOR,
  type ResolvedScope,
  type Scope,
  type ScopeCount,
  type ScopeEntity,
  type ScopeFilters,
  type ScopeRow,
  type ScopeSort,
  type AssumedKey,
} from "@/lib/ai/scope-schema";
import { resolveScopeAction } from "@/lib/actions/scope";
import { cn } from "@/lib/utils";

const ENTITY_WORD: Record<ScopeEntity, string> = {
  task: "tasks",
  habit: "habits",
  goal: "goals",
  project: "projects",
  note: "notes",
};

const SORT_WORD: Record<ScopeSort, string> = {
  created: "Created",
  due: "Due date",
  target: "Target date",
  edited: "Last edited",
  priority: "Priority",
  progress: "Progress",
  alpha: "A to Z",
};

const STATUS_WORD = { todo: "To do", doing: "In progress", done: "Done" };
const PRIORITY_WORD = { high: "High", med: "Mid", low: "Low" };
const WINDOW_WORD = {
  any: "Any",
  overdue: "Overdue",
  today: "Today",
  thisWeek: "This week",
  thisMonth: "This month",
  undated: "No date",
};

/**
 * The step between "what you asked" and "what will change".
 *
 * It exists because the model has to fill in things the user did not say —
 * "the oldest 3 tasks" says nothing about whether finished ones count — and
 * the old behaviour was to guess silently and act. Every guess is now a
 * control with the guess already in it, and the rows it selects are shown
 * before anything is drafted.
 *
 * Only appears when something WAS assumed. A fully-stated request goes
 * straight to the draft, or this becomes a click between a person and the
 * thing they already asked for clearly.
 */
export function ScopeScreen({
  intent,
  summary,
  scope: initial,
  resolved: initialResolved,
  tags,
  patchLabel,
  willChange,
  onDraft,
  onCancel,
}: {
  intent: string;
  summary: string;
  scope: Scope;
  resolved: ResolvedScope;
  tags: Tag[];
  /** "med → high", for the row's trailing column. */
  patchLabel: (row: ScopeRow) => React.ReactNode;
  /**
   * Does this row actually change?
   *
   * A row already holding the patched value is selected by the criteria and
   * still produces no operation, so counting it would promise three changes
   * and deliver two. It stays visible, marked, rather than disappearing:
   * "already high" is information, and a row vanishing from a preview it
   * matched is not.
   */
  willChange: (row: ScopeRow) => boolean;
  onDraft: (scope: Scope) => void;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState<Scope>(initial);
  const [resolved, setResolved] = useState<ResolvedScope>(initialResolved);
  const [pending, start] = useTransition();
  // Which controls the model filled in itself, frozen at arrival: once the
  // user touches one it is their decision, not an assumption, but the marker
  // should not vanish the moment they merely look at it.
  const assumed = useMemo(
    () => new Set(initial.assumed ?? []),
    [initial.assumed],
  );
  const [touched, setTouched] = useState<Set<AssumedKey>>(new Set());

  // Re-resolve on every change, so the right-hand column is never a promise
  // about rows — it IS the rows.
  //
  // The first run is skipped only when a resolution actually arrived with the
  // props: the server resolves the scope on the same request that produces
  // this screen, so re-asking immediately would be a second identical query.
  // An EMPTY one means nobody has resolved it yet, and skipping then would
  // leave the column blank forever.
  const first = useRef(initialResolved.matched > 0);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let live = true;
    start(async () => {
      const res = await resolveScopeAction(scope);
      if (!live) return;
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (!res.data) return;
      setResolved(res.data);
    });
    return () => {
      live = false;
    };
  }, [scope]);

  const patch = <K extends keyof ScopeFilters>(key: K, value: ScopeFilters[K]) => {
    setTouched((t) => new Set(t).add(key));
    setScope((s) => ({ ...s, filters: { ...s.filters, [key]: value } }));
  };
  const toggleIn = <T extends string>(
    key: keyof ScopeFilters,
    list: readonly T[] | null | undefined,
    value: T,
    all: readonly T[],
  ) => {
    const current = list ?? [];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : all.filter((v) => current.includes(v) || v === value);
    patch(key, (next.length ? next : undefined) as never);
  };

  const shows = (key: keyof ScopeFilters) =>
    FILTERS_FOR[scope.entity].includes(key);
  const guessed = (key: AssumedKey) => assumed.has(key) && !touched.has(key);

  // What will actually happen, as opposed to what matched.
  const changing = resolved.rows.filter(willChange).length;

  const assumedWords = [...assumed]
    .filter((k) => !touched.has(k))
    .map((k) =>
      k === "status"
        ? "not done yet"
        : k === "sort"
          ? `ordered by ${SORT_WORD[scope.sort.by].toLowerCase()}`
          : k === "count"
            ? `${scope.count} of them`
            : k,
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-2">
          <span className="block h-2 w-2 bg-notes" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-faint2">
            Before drafting · {assumedWords.length}{" "}
            {assumedWords.length === 1 ? "assumption" : "assumptions"}
          </span>
        </div>
        <p className="m-0 max-w-[52ch] text-[17px] font-semibold leading-snug tracking-tight text-ink">
          {summary}
        </p>
        <p className="m-0 mt-1.5 text-[13px] text-muted">
          You asked: <span className="text-ink">“{intent}”</span>
        </p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[312px_minmax(0,1fr)]">
        {/* ── the query ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 rounded-[13px] border border-border bg-surface p-4 shadow-[2px_2px_0_var(--shadow)]">
          <Field label="Looking at">
            {SCOPE_ENTITIES.map((e) => (
              <Chip
                key={e}
                on={scope.entity === e}
                onClick={() =>
                  setScope((s) => ({
                    ...s,
                    entity: e,
                    // Filters and sorts are per entity; carrying a task's
                    // status filter onto notes would silently match nothing.
                    filters: {},
                    sort: { by: SORTS_FOR[e][0], reversed: false },
                  }))
                }
              >
                {ENTITY_WORD[e]}
              </Chip>
            ))}
          </Field>

          {shows("status") && (
            <Field label="Status" guess={guessed("status")}>
              {(["todo", "doing", "done"] as const).map((v) => (
                <Chip
                  key={v}
                  on={(scope.filters.status ?? []).includes(v)}
                  onClick={() =>
                    toggleIn("status", scope.filters.status, v, [
                      "todo",
                      "doing",
                      "done",
                    ])
                  }
                >
                  {STATUS_WORD[v]}
                </Chip>
              ))}
            </Field>
          )}

          {shows("priority") && (
            <Field label="Priority">
              {(["high", "med", "low"] as const).map((v) => (
                <Chip
                  key={v}
                  on={(scope.filters.priority ?? []).includes(v)}
                  onClick={() =>
                    toggleIn("priority", scope.filters.priority, v, [
                      "high",
                      "med",
                      "low",
                    ])
                  }
                >
                  {PRIORITY_WORD[v]}
                </Chip>
              ))}
            </Field>
          )}

          {shows("due") && (
            <Field label="Due">
              {(["any", "overdue", "today", "thisWeek", "undated"] as const).map(
                (v) => (
                  <Chip
                    key={v}
                    on={(scope.filters.due ?? "any") === v}
                    onClick={() => patch("due", v)}
                  >
                    {WINDOW_WORD[v]}
                  </Chip>
                ),
              )}
            </Field>
          )}

          {shows("archived") && (
            <Field label="Archived">
              <Chip
                on={!scope.filters.archived}
                onClick={() => patch("archived", false)}
              >
                Active
              </Chip>
              <Chip
                on={Boolean(scope.filters.archived)}
                onClick={() => patch("archived", true)}
              >
                Archived
              </Chip>
            </Field>
          )}

          {tags.length > 0 && shows("tagIds") && (
            <Field label="Tagged">
              {tags.slice(0, 8).map((t) => {
                const on = (scope.filters.tagIds ?? []).includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      toggleIn(
                        "tagIds",
                        scope.filters.tagIds,
                        t.id,
                        tags.map((x) => x.id),
                      )
                    }
                    className={cn(
                      "rounded-[7px] border px-2.5 py-1 font-mono text-[11px] font-semibold transition-[color,background-color,border-color,box-shadow] duration-150",
                      on
                        ? "animate-chip-pick"
                        : "border-border bg-surface text-muted hover:border-faint",
                    )}
                    style={
                      on
                        ? {
                            borderColor: t.color,
                            color: t.color,
                            background: `color-mix(in oklab, ${t.color} 12%, transparent)`,
                            boxShadow: `inset 0 0 0 1px ${t.color}`,
                          }
                        : undefined
                    }
                  >
                    #{t.name}
                  </button>
                );
              })}
            </Field>
          )}

          <Field
            label={scope.sort.reversed ? "Newest by" : "Oldest by"}
            guess={guessed("sort")}
          >
            {SORTS_FOR[scope.entity].map((v) => (
              <Chip
                key={v}
                on={scope.sort.by === v}
                onClick={() => {
                  setTouched((t) => new Set(t).add("sort"));
                  setScope((s) => ({ ...s, sort: { ...s.sort, by: v } }));
                }}
              >
                {SORT_WORD[v]}
              </Chip>
            ))}
            <Chip
              on={scope.sort.reversed}
              onClick={() => {
                setTouched((t) => new Set(t).add("sort"));
                setScope((s) => ({
                  ...s,
                  sort: { ...s.sort, reversed: !s.sort.reversed },
                }));
              }}
            >
              Reversed
            </Chip>
          </Field>

          <Field label="How many" guess={guessed("count")}>
            {COUNT_CHOICES.map((c) => (
              <Chip
                key={String(c)}
                on={scope.count === c}
                onClick={() => {
                  setTouched((t) => new Set(t).add("count"));
                  setScope((s) => ({ ...s, count: c as ScopeCount }));
                }}
              >
                {c === "all" ? "All" : c}
              </Chip>
            ))}
          </Field>
        </div>

        {/* ── the result ────────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-col">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-faint2">
              {pending
                ? "Reading…"
                : `Selected · ${resolved.ids.length} of ${resolved.matched} matching`}
              {changing !== resolved.ids.length &&
                ` · ${resolved.ids.length - changing} already set`}
            </span>
            {resolved.capped && (
              <span className="font-mono text-[10px] text-tasks">
                capped at {resolved.ids.length}
              </span>
            )}
          </div>

          {assumedWords.length > 0 && (
            <div className="mb-2.5 flex items-start gap-2 rounded-[11px] border border-border border-l-[3px] border-l-notes bg-surface px-3 py-2.5">
              <span
                aria-hidden
                className="mt-1.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-notes"
              />
              <p className="m-0 text-[12.5px] leading-relaxed text-muted">
                <span className="font-semibold text-ink">Assumed:</span>{" "}
                {assumedWords.join(", ")}. Change anything on the left.
              </p>
            </div>
          )}

          <div
            className={cn(
              "flex flex-col gap-1.5 transition-opacity",
              pending && "opacity-60",
            )}
          >
            {resolved.rows.length === 0 && (
              <p className="m-0 rounded-[11px] border border-dashed border-border bg-surface2 px-3 py-4 text-center text-[12.5px] text-faint">
                Nothing matches those filters.
              </p>
            )}
            {resolved.rows.map((row) => {
              const changes = willChange(row);
              return (
              <div
                key={row.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-[11px] border border-border border-l-[3px] px-3 py-2.5",
                  changes ? "bg-surface" : "bg-surface2 opacity-70",
                )}
                style={{
                  borderLeftColor: changes ? "var(--tasks)" : "var(--border)",
                }}
              >
                {changes ? (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] bg-ink">
                    <Check
                      className="h-2.5 w-2.5 text-background"
                      strokeWidth={3.5}
                    />
                  </span>
                ) : (
                  <span className="h-4 w-4 shrink-0 rounded-[5px] border border-border" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-[13.5px] font-semibold text-ink">
                    {row.title}
                  </p>
                  <p className="m-0 mt-0.5 font-mono text-[10.5px] text-faint">
                    {row.detail}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-faint2">
                  {patchLabel(row)}
                </span>
              </div>
              );
            })}

            {/* What the count left out. The original bug was invisible
                precisely because nothing ever showed which rows lost. */}
            {resolved.excluded.length > 0 && (
              <>
                <div className="my-1 flex items-center gap-2.5">
                  <span className="h-px flex-1 border-t border-dashed border-border" />
                  <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-widest text-faint2">
                    cut off by “{scope.count === "all" ? "all" : scope.count}”
                  </span>
                  <span className="h-px flex-1 border-t border-dashed border-border" />
                </div>
                {resolved.excluded.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center gap-2.5 rounded-[11px] border border-border2 bg-surface2 px-3 py-2 opacity-55"
                  >
                    <span className="h-4 w-4 shrink-0 rounded-[5px] border border-border" />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-[13px] font-medium text-muted">
                        {row.title}
                      </p>
                      <p className="m-0 mt-0.5 font-mono text-[10.5px] text-faint2">
                        {row.detail}
                      </p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          <div className="mt-5 flex items-center gap-2 border-t border-border2 pt-4">
            <button
              type="button"
              disabled={pending || changing === 0}
              onClick={() => onDraft(scope)}
              className="rounded-[9px] border-[1.5px] border-ink bg-ink px-3.5 py-2 text-[12.5px] font-bold text-background transition-colors hover:bg-ink/90 disabled:opacity-50"
            >
              Draft {changing} {changing === 1 ? "change" : "changes"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-[9px] border-[1.5px] border-border bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-ink transition-colors hover:border-faint2"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  guess,
  children,
}: {
  label: string;
  guess?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        guess && "-mx-2.5 rounded-[9px] px-2.5 py-2.5",
      )}
      style={
        guess
          ? { background: "color-mix(in oklab, var(--notes) 8%, transparent)" }
          : undefined
      }
    >
      <span
        className={cn(
          "mb-1.5 block font-mono text-[10px] uppercase tracking-widest",
          guess ? "text-notes" : "text-faint2",
        )}
      >
        {label}
        {guess && " · assumed"}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

/** The app's chip, with the non-flicker recipe: 1px border, inset ring. */
function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-[7px] border px-2.5 py-1 font-mono text-[11px] font-semibold transition-[color,background-color,border-color,box-shadow] duration-150",
        on
          ? "animate-chip-pick border-primary bg-primary/[0.12] text-primary"
          : "border-border bg-surface text-muted hover:border-faint hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
