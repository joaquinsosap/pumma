"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, ChevronRight } from "@/components/icons";
import type {
  ExistingEntities,
  PlanGraph as Plan,
  PlanTask,
} from "@/lib/ai/plan-schema";
import { cn } from "@/lib/utils";

type Props = { plan: Plan; existing: ExistingEntities };

type Edge = { from: string; to: string };
type Line = { x1: number; y1: number; x2: number; y2: number };

// Only one project expanded at a time so tasks stay easy to scan.
function initialCollapsed(plan: Plan): Set<string> {
  const perProject = new Map<string, number>();
  for (const t of plan.tasks) {
    if (t.projectRef)
      perProject.set(t.projectRef, (perProject.get(t.projectRef) ?? 0) + 1);
  }
  const entries = [...perProject.entries()];
  if (!entries.length) return new Set();

  const keepExpanded = entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const s = new Set<string>();
  for (const [ref] of entries)
    if (ref !== keepExpanded) s.add(`project:${ref}`);
  return s;
}

function allProjectKeys(plan: Plan, existing: ExistingEntities): string[] {
  const keys = new Set<string>();
  for (const p of plan.projects) keys.add(`project:${p.refId}`);
  for (const p of existing.projects) keys.add(`project:${p.id}`);
  for (const t of plan.tasks) {
    if (t.projectRef) keys.add(`project:${t.projectRef}`);
  }
  return [...keys];
}

export function PlanGraph({ plan, existing }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [lines, setLines] = useState<Line[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    initialCollapsed(plan),
  );

  useEffect(() => setCollapsed(initialCollapsed(plan)), [plan]);

  const projectKeys = useMemo(
    () => allProjectKeys(plan, existing),
    [plan, existing],
  );

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleProject = useCallback(
    (refId: string) => {
      const key = `project:${refId}`;
      setCollapsed((prev) => {
        const next = new Set(prev);
        const opening = next.has(key);
        for (const pk of projectKeys) next.add(pk);
        if (opening) next.delete(key);
        return next;
      });
    },
    [projectKeys],
  );

  const setNode = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) nodeRefs.current.set(key, el);
      else nodeRefs.current.delete(key);
    },
    [],
  );

  // --- Nodes (refId for new, real id for existing) ---
  const existingGoalTitle = new Map(existing.goals.map((g) => [g.id, g.title]));
  const existingProjectTitle = new Map(
    existing.projects.map((p) => [p.id, p.title]),
  );

  const goalNodes = new Map<string, { title: string; existing: boolean }>();
  for (const g of plan.goals)
    goalNodes.set(g.refId, { title: g.title, existing: false });

  const projectNodes = new Map<string, { title: string; existing: boolean }>();
  for (const p of plan.projects)
    projectNodes.set(p.refId, { title: p.title, existing: false });

  const noteGoal = (ref?: string | null) => {
    if (ref && !goalNodes.has(ref) && existingGoalTitle.has(ref))
      goalNodes.set(ref, {
        title: existingGoalTitle.get(ref)!,
        existing: true,
      });
  };
  const noteProject = (ref?: string | null) => {
    if (ref && !projectNodes.has(ref) && existingProjectTitle.has(ref))
      projectNodes.set(ref, {
        title: existingProjectTitle.get(ref)!,
        existing: true,
      });
  };

  // Group tasks by container, and collect edges.
  const tasksByContainer = new Map<string, PlanTask[]>();
  const containerOf = (t: PlanTask): string | null => {
    if (t.projectRef && projectNodes.has(t.projectRef))
      return `project:${t.projectRef}`;
    if (t.goalRef && goalNodes.has(t.goalRef)) return `goal:${t.goalRef}`;
    return null;
  };

  const edges: Edge[] = [];
  for (const p of plan.projects) {
    noteGoal(p.goalRef);
    if (p.goalRef && goalNodes.has(p.goalRef))
      edges.push({ from: `goal:${p.goalRef}`, to: `project:${p.refId}` });
  }
  for (const h of plan.habits)
    for (const ref of h.goalRefs) {
      noteGoal(ref);
      if (goalNodes.has(ref))
        edges.push({ from: `goal:${ref}`, to: `habit:${h.refId}` });
    }
  for (const t of plan.tasks) {
    noteProject(t.projectRef);
    noteGoal(t.goalRef);
    const c = containerOf(t);
    if (c) {
      const arr = tasksByContainer.get(c) ?? [];
      arr.push(t);
      tasksByContainer.set(c, arr);
      edges.push({ from: c, to: `task:${t.refId}` });
    } else {
      const arr = tasksByContainer.get("none") ?? [];
      arr.push(t);
      tasksByContainer.set("none", arr);
    }
  }

  // --- Visibility (a collapsed container hides its descendants) ---
  const goalCollapsed = (gk: string) => collapsed.has(`goal:${gk}`);
  const projectParentGoal = (refId: string) =>
    plan.projects.find((p) => p.refId === refId)?.goalRef ?? null;
  const projectVisible = (refId: string) => {
    const pg = projectParentGoal(refId);
    return pg && goalNodes.has(pg) ? !goalCollapsed(pg) : true;
  };
  const habitVisible = (goalRefs: string[]) =>
    goalRefs.length === 0 ||
    goalRefs.some((g) => (goalNodes.has(g) ? !goalCollapsed(g) : true));
  const taskVisible = (t: PlanTask) => {
    const c = containerOf(t);
    if (!c) return true;
    if (c.startsWith("goal:")) return !collapsed.has(c);
    if (c.startsWith("project:")) {
      const ref = c.slice("project:".length);
      return projectVisible(ref) && !collapsed.has(c);
    }
    return true;
  };

  const goalChildCount = (gk: string) =>
    plan.projects.filter((p) => p.goalRef === gk).length +
    plan.habits.filter((h) => h.goalRefs.includes(gk)).length +
    (tasksByContainer.get(`goal:${gk}`)?.length ?? 0);

  // --- Measure connectors after layout / on collapse / resize ---
  useLayoutEffect(() => {
    const recompute = () => {
      const container = containerRef.current;
      if (!container) return;
      const base = container.getBoundingClientRect();
      const next: Line[] = [];
      for (const e of edges) {
        const a = nodeRefs.current.get(e.from);
        const b = nodeRefs.current.get(e.to);
        if (!a || !b) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        next.push({
          x1: ra.right - base.left,
          y1: ra.top + ra.height / 2 - base.top,
          x2: rb.left - base.left,
          y2: rb.top + rb.height / 2 - base.top,
        });
      }
      setLines(next);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, collapsed]);

  const visibleTasks = plan.tasks.filter(taskVisible);

  const taskGroups: { key: string; tasks: PlanTask[] }[] = [];
  const groupIndex = new Map<string, number>();
  for (const t of visibleTasks) {
    const key = containerOf(t) ?? "none";
    let idx = groupIndex.get(key);
    if (idx === undefined) {
      idx = taskGroups.length;
      groupIndex.set(key, idx);
      taskGroups.push({ key, tasks: [] });
    }
    taskGroups[idx]!.tasks.push(t);
  }

  const hasGraph =
    goalNodes.size +
      projectNodes.size +
      plan.habits.length +
      plan.tasks.length >
    0;

  return (
    <div>
      <div className="lg:overflow-x-auto">
        <div ref={containerRef} className="relative lg:min-w-[760px]">
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible max-lg:hidden"
            aria-hidden
          >
            <defs>
              <marker
                id="plan-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-faint2" />
              </marker>
            </defs>
            {lines.map((l, i) => {
              const dx = Math.max(28, (l.x2 - l.x1) / 2);
              return (
                <path
                  key={i}
                  d={`M ${l.x1} ${l.y1} C ${l.x1 + dx} ${l.y1}, ${l.x2 - dx} ${l.y2}, ${l.x2} ${l.y2}`}
                  className="stroke-faint2/70"
                  strokeWidth={1.5}
                  fill="none"
                  markerEnd="url(#plan-arrow)"
                />
              );
            })}
          </svg>

          {hasGraph ? (
            <div className="relative z-10 grid gap-y-6 max-lg:gap-y-5 lg:grid-cols-[minmax(190px,1fr)_minmax(220px,1fr)_minmax(240px,1.1fr)] lg:gap-x-16">
              <Column label="Goals" dot="var(--goals)">
                {[...goalNodes].map(([key, n]) => {
                  const count = goalChildCount(key);
                  return (
                    <ContainerCard
                      key={key}
                      nodeRef={setNode(`goal:${key}`)}
                      title={n.title}
                      accent="goals"
                      existing={n.existing}
                      childCount={count}
                      collapsed={collapsed.has(`goal:${key}`)}
                      onToggle={count ? () => toggle(`goal:${key}`) : undefined}
                    />
                  );
                })}
              </Column>

              <Column label="Projects · Habits" dot="var(--primary)">
                {plan.projects.map((p) =>
                  projectVisible(p.refId) ? (
                    <ContainerCard
                      key={p.refId}
                      nodeRef={setNode(`project:${p.refId}`)}
                      title={p.title}
                      meta={p.lifeArea}
                      accent="primary"
                      childCount={
                        tasksByContainer.get(`project:${p.refId}`)?.length ?? 0
                      }
                      collapsed={collapsed.has(`project:${p.refId}`)}
                      taskToggle
                      onToggle={
                        tasksByContainer.get(`project:${p.refId}`)?.length
                          ? () => toggleProject(p.refId)
                          : undefined
                      }
                      bestPractices={p.bestPractices ?? undefined}
                      description={p.description ?? undefined}
                    />
                  ) : null,
                )}
                {[...projectNodes]
                  .filter(([, n]) => n.existing)
                  .map(([key, n]) => (
                    <ContainerCard
                      key={key}
                      nodeRef={setNode(`project:${key}`)}
                      title={n.title}
                      accent="primary"
                      existing
                      childCount={
                        tasksByContainer.get(`project:${key}`)?.length ?? 0
                      }
                      collapsed={collapsed.has(`project:${key}`)}
                      taskToggle
                      onToggle={
                        tasksByContainer.get(`project:${key}`)?.length
                          ? () => toggleProject(key)
                          : undefined
                      }
                    />
                  ))}
                {plan.habits.map((h) =>
                  habitVisible(h.goalRefs) ? (
                    <SimpleNode
                      key={h.refId}
                      nodeRef={setNode(`habit:${h.refId}`)}
                      title={h.name}
                      meta={h.frequency}
                      accent="habits"
                    />
                  ) : null,
                )}
              </Column>

              <Column label="Tasks" dot="var(--tasks)">
                {taskGroups.map((group) => (
                  <div
                    key={group.key}
                    className="flex flex-col gap-4 max-lg:gap-2.5"
                  >
                    {/* Phone loses the connector arrows — say the linkage instead. */}
                    {group.key !== "none" && (
                      <div className="font-mono text-[9px] uppercase tracking-wide text-faint lg:hidden">
                        ↳{" "}
                        {group.key.startsWith("project:")
                          ? projectNodes.get(group.key.slice(8))?.title
                          : goalNodes.get(group.key.slice(5))?.title}
                      </div>
                    )}
                    {group.tasks.map((t) => (
                      <TaskCard
                        key={t.refId}
                        nodeRef={setNode(`task:${t.refId}`)}
                        task={t}
                      />
                    ))}
                  </div>
                ))}
                {visibleTasks.length === 0 && (
                  <div className="rounded-[11px] border border-dashed border-border p-3 text-[12px] text-faint">
                    Expand a project to see its tasks.
                  </div>
                )}
              </Column>
            </div>
          ) : null}
        </div>
      </div>

      {plan.notes.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-faint">
            Notes
          </div>
          <div className="flex flex-col gap-2">
            {plan.notes.map((n) => (
              <div
                key={n.refId}
                className="rounded-[11px] border border-border bg-surface p-3"
              >
                <div className="text-[13px] font-semibold">{n.title}</div>
                <div className="mt-1 line-clamp-2 text-[12px] text-muted">
                  {n.body}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Column({
  label,
  dot,
  children,
}: {
  label: string;
  dot?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 max-lg:gap-3">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-faint">
        {dot && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: dot }}
            aria-hidden
          />
        )}
        {label}
      </div>
      {children}
    </div>
  );
}

const ACCENT: Record<string, string> = {
  goals: "text-goals",
  habits: "text-habits",
  tasks: "text-tasks",
  primary: "text-primary",
};

/** Goal / Project node: title, optional collapse toggle, optional best-practices + description dropdowns. */
function ContainerCard({
  nodeRef,
  title,
  meta,
  accent,
  existing,
  childCount,
  collapsed,
  taskToggle,
  onToggle,
  bestPractices,
  description,
}: {
  nodeRef: (el: HTMLElement | null) => void;
  title: string;
  meta?: string;
  accent: string;
  existing?: boolean;
  childCount?: number;
  collapsed?: boolean;
  taskToggle?: boolean;
  onToggle?: () => void;
  bestPractices?: string[];
  description?: string;
}) {
  const expanded = Boolean(onToggle && !collapsed);
  const taskCount = childCount ?? 0;

  return (
    <div
      ref={nodeRef}
      className={cn(
        "rounded-[11px] border bg-surface p-3.5 shadow-sm transition-colors",
        existing
          ? "border-dashed border-faint2/70 opacity-80"
          : "border-border",
        taskToggle && expanded && "border-primary/50 bg-primary/[0.05]",
      )}
    >
      <div className="flex items-start gap-2">
        {onToggle && !taskToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="mt-0.5 shrink-0 rounded-md p-0.5 text-muted hover:bg-hover hover:text-ink"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4 stroke-[2.5]" />
            ) : (
              <ChevronDown className="h-4 w-4 stroke-[2.5]" />
            )}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="text-[13px] font-semibold leading-snug">
              {title}
            </div>
            {existing && (
              <span className="shrink-0 rounded bg-surface2 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wide text-faint">
                existing
              </span>
            )}
          </div>
          {meta && (
            <div
              className={cn(
                "mt-1 font-mono text-[10px] lowercase",
                ACCENT[accent] ?? "text-muted",
              )}
            >
              {meta}
            </div>
          )}
          {description && (
            <div className="mt-1.5 line-clamp-2 text-[11.5px] text-muted">
              {description}
            </div>
          )}
          {bestPractices && bestPractices.length > 0 && (
            <details className="mt-2 group">
              <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-wide text-primary">
                ▸ best practices ({bestPractices.length})
              </summary>
              <ul className="mt-1.5 space-y-1 pl-1">
                {bestPractices.map((b, i) => (
                  <li key={i} className="flex gap-1.5 text-[11.5px] text-muted">
                    <span className="text-primary">•</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {taskToggle && onToggle && taskCount > 0 && (
            <button
              type="button"
              onClick={onToggle}
              className={cn(
                "mt-2.5 flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                expanded
                  ? "border-primary/40 bg-primary/10 hover:bg-primary/[0.14]"
                  : "border-border bg-surface2 hover:border-faint2 hover:bg-hover",
              )}
              aria-expanded={expanded}
              aria-label={
                expanded
                  ? `Hide ${taskCount} tasks for ${title}`
                  : `Show ${taskCount} tasks for ${title}`
              }
            >
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-semibold text-ink">
                  {expanded ? "Showing tasks" : "Show tasks"}
                </span>
                <span className="font-mono text-[10px] text-muted">
                  {taskCount} task{taskCount === 1 ? "" : "s"} · {title}
                </span>
              </span>
              {collapsed ? (
                <ChevronRight className="h-4 w-4 shrink-0 stroke-[2.5] text-ink" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 stroke-[2.5] text-ink" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SimpleNode({
  nodeRef,
  title,
  meta,
  accent,
}: {
  nodeRef: (el: HTMLElement | null) => void;
  title: string;
  meta?: string;
  accent: string;
}) {
  return (
    <div
      ref={nodeRef}
      className="rounded-[11px] border border-border bg-surface p-3.5 shadow-sm"
    >
      <div className="text-[13px] font-semibold leading-snug">{title}</div>
      {meta && (
        <div
          className={cn(
            "mt-1 font-mono text-[10px] lowercase",
            ACCENT[accent] ?? "text-muted",
          )}
        >
          {meta}
        </div>
      )}
    </div>
  );
}

function TaskCard({
  nodeRef,
  task,
}: {
  nodeRef: (el: HTMLElement | null) => void;
  task: PlanTask;
}) {
  const subtasks = task.subtasks ?? [];
  return (
    <div
      ref={nodeRef}
      className="rounded-[11px] border border-border bg-surface p-3.5 shadow-sm"
    >
      <div className="text-[13px] font-semibold leading-snug">{task.title}</div>
      <div className="mt-1 font-mono text-[10px] lowercase text-tasks">
        {task.priority}
        {task.due ? ` · ${task.due}` : ""}
      </div>
      {task.description && (
        <div className="mt-1.5 line-clamp-3 text-[11.5px] text-muted">
          {task.description}
        </div>
      )}
      {subtasks.length > 0 && (
        <details className="mt-2" open={subtasks.length <= 4}>
          <summary className="cursor-pointer list-none font-mono text-[10px] uppercase tracking-wide text-faint">
            ▸ {subtasks.length} steps
          </summary>
          <ol className="mt-1.5 space-y-1 pl-1">
            {subtasks.map((s, i) => (
              <li key={i} className="flex gap-1.5 text-[11.5px] text-muted">
                <span className="font-mono text-faint">{i + 1}.</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
