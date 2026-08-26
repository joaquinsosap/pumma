"use client";

// The changeset canvas: an indent-rail tree of proposed operations the user
// reviews, edits, drags, reprompts, and applies. Rows read top-down like a
// document outline — depth is indentation, connectors are 1px rails.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Check,
  TriangleAlert,
  MoreHorizontal,
  Trash2,
  Pencil,
  Sparkles,
  EyeOff,
  Eye,
} from "@/components/icons";
import { toast } from "sonner";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  blankOpFields,
  type ChangeOp,
  type Changeset,
  type ChangeEntity,
} from "@/lib/ai/changeset-schema";
import {
  applyChangesetAction,
  previewChangesetAction,
  repromptNodeAction,
  undoChangesetAction,
  type ApplyChangesetResult,
  type DeleteRadius,
  type OpProblem,
} from "@/lib/actions/changeset";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Draft model: ops with stable client keys, so exclusion and edits survive
// reordering and reprompt patches.

type DraftOp = { key: string; op: ChangeOp };

let keyCounter = 0;
const mintKey = () => `k${++keyCounter}`;

const ENTITY_COLOR: Record<ChangeEntity, string> = {
  goal: "var(--goals)",
  project: "var(--projects)",
  habit: "var(--habits)",
  task: "var(--tasks)",
  note: "var(--notes)",
  meeting: "var(--calendar)",
};

/** The op's display title, whatever shape its fields take. */
function opTitle(op: ChangeOp): string {
  if (op.op !== "create") return op.label;
  return op.fields.title || "Untitled";
}

/** The ref/id this op files under, if any — what nests it in the tree. */
function parentOf(op: ChangeOp): string | null {
  if (op.op === "delete") return null;
  return (
    op.fields.projectId || op.fields.goalId || op.fields.goalIds?.[0] || null
  );
}

function setTitle(op: ChangeOp, title: string): ChangeOp {
  if (op.op === "delete") return op;
  return { ...op, fields: { ...op.fields, title } };
}

/** Re-file a draft op under another draft op (or a real id). */
function setParent(op: ChangeOp, ref: string | null): ChangeOp {
  if (op.op === "delete") return op;
  if (op.entity === "task") {
    return { ...op, fields: { ...op.fields, projectId: ref ?? undefined } };
  }
  if (op.entity === "project") {
    return { ...op, fields: { ...op.fields, goalId: ref ?? undefined } };
  }
  return op;
}

// ---------------------------------------------------------------------------

type Props = {
  changeset: Changeset;
  intent: string;
  quotaLabel?: string | null;
  onFlipMode: () => void;
  onDiscard: () => void;
};

type Phase =
  | { name: "editing" }
  | { name: "confirming" }
  | { name: "applied"; result: ApplyChangesetResult };

export function ChangesetCanvas({
  changeset,
  intent,
  quotaLabel,
  onFlipMode,
  onDiscard,
}: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftOp[]>(() =>
    changeset.ops.map((op) => ({ key: mintKey(), op })),
  );
  // A changeset with nothing in it is a real outcome ("archive the habits I do
  // less than weekly" when none qualify) — say so rather than showing an empty
  // canvas with an Apply button that does nothing.
  const emptyDraft = !changeset.ops.length;
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>({ name: "editing" });
  const [problems, setProblems] = useState<Map<string, string>>(new Map());
  const [deletes, setDeletes] = useState<DeleteRadius[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [undoDone, setUndoDone] = useState(false);
  const [pending, startTransition] = useTransition();

  // The draft references ops by index in the preview API; map back to keys.
  const keyAt = useCallback((index: number) => draft[index]?.key, [draft]);

  // Stale-check + delete radius against live data, once per draft shape.
  const previewedFor = useRef<string>("");
  useEffect(() => {
    const signature = draft.map((d) => d.key).join(",");
    if (previewedFor.current === signature) return;
    previewedFor.current = signature;
    const ops = draft.map((d) => d.op);
    void previewChangesetAction({ summary: changeset.summary, ops }).then(
      (res) => {
        if (!res.ok || !res.data) return;
        setProblems(
          new Map(
            res.data.problems.map((p: OpProblem) => [
              keyAt(p.index)!,
              p.message,
            ]),
          ),
        );
        setDeletes(res.data.deletes);
        setNames(res.data.names);
      },
    );
  }, [draft, changeset.summary, keyAt]);

  const included = draft.filter((d) => !excluded.has(d.key));
  const includedProblems = included.filter((d) => problems.has(d.key));
  const includedDeletes = included.filter((d) => d.op.op === "delete");

  const counts = useMemo(() => {
    const c = { create: 0, update: 0, delete: 0 };
    for (const d of included) c[d.op.op]++;
    return c;
  }, [included]);

  const patchOp = (key: string, next: ChangeOp) =>
    setDraft((ds) => ds.map((d) => (d.key === key ? { ...d, op: next } : d)));

  const addTaskUnder = (projectRefOrId: string) =>
    setDraft((ds) => [
      ...ds,
      {
        key: mintKey(),
        op: {
          op: "create",
          entity: "task",
          refId: `new-${mintKey()}`,
          fields: { ...blankOpFields(), projectId: projectRefOrId },
        },
      },
    ]);

  const dropOp = (key: string) =>
    setDraft((ds) => ds.filter((d) => d.key !== key));

  const apply = () => {
    startTransition(async () => {
      const res = await applyChangesetAction({
        summary: changeset.summary,
        ops: included.map((d) => d.op),
      });
      if (!res.ok || !res.data) {
        toast.error((!res.ok && res.error) || "Apply failed");
        setPhase({ name: "editing" });
        return;
      }
      setPhase({ name: "applied", result: res.data });
      router.refresh();
    });
  };

  const applyWithoutDeletes = () => {
    setExcluded((x) => {
      const next = new Set(x);
      for (const d of includedDeletes) next.add(d.key);
      return next;
    });
    // Deletes excluded → no confirmation needed on the re-entry.
    setPhase({ name: "editing" });
    startTransition(async () => {
      const ops = included.filter((d) => d.op.op !== "delete").map((d) => d.op);
      const res = await applyChangesetAction({
        summary: changeset.summary,
        ops,
      });
      if (!res.ok || !res.data) {
        toast.error((!res.ok && res.error) || "Apply failed");
        return;
      }
      setPhase({ name: "applied", result: res.data });
      router.refresh();
    });
  };

  const undo = (result: ApplyChangesetResult) => {
    startTransition(async () => {
      const res = await undoChangesetAction(result.undo);
      if (!res.ok) {
        toast.error(res.error ?? "Undo failed");
        return;
      }
      setUndoDone(true);
      router.refresh();
    });
  };

  // --- drag to re-associate -------------------------------------------------
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 280, tolerance: 8 },
    }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const from = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over || from === over) return;
    const source = draft.find((d) => d.key === from);
    const target = draft.find((d) => d.key === over);
    if (!source || !target) return;
    // task → project, project → goal; anything else is not a filing.
    const valid =
      (source.op.entity === "task" && target.op.entity === "project") ||
      (source.op.entity === "project" && target.op.entity === "goal");
    if (!valid || target.op.op === "delete") return;
    const ref = target.op.op === "create" ? target.op.refId : target.op.id;
    patchOp(from, setParent(source.op, ref));
  };

  if (emptyDraft) {
    return (
      <div className="flex flex-col gap-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="block h-2 w-2 bg-primary" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-faint2">
            Nothing to change
          </span>
        </div>
        <p className="m-0 max-w-[52ch] text-[17px] font-semibold leading-snug tracking-tight text-ink">
          {changeset.summary}
        </p>
        <p className="m-0 text-[13px] text-muted">
          You asked: <span className="text-ink">“{intent}”</span>
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={onFlipMode}
            className="rounded-[9px] border-[1.5px] border-border bg-surface px-3 py-2 text-[12.5px] font-semibold text-ink hover:border-faint2"
          >
            Ask about it instead
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-[9px] bg-ink px-3.5 py-2 text-[12.5px] font-bold text-background"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // --- applied view ---------------------------------------------------------
  if (phase.name === "applied") {
    return (
      <AppliedView
        result={phase.result}
        undone={undoDone}
        pending={pending}
        onUndo={() => undo(phase.result)}
        onDone={onDiscard}
      />
    );
  }

  // --- tree assembly --------------------------------------------------------
  const byRef = new Map<string, DraftOp>();
  for (const d of draft) {
    if (d.op.op === "create") byRef.set(d.op.refId, d);
    else byRef.set(d.op.id, d);
  }
  const childrenOf = new Map<string, DraftOp[]>();
  const roots: DraftOp[] = [];
  for (const d of draft) {
    const ref = parentOf(d.op);
    const parent = ref ? byRef.get(ref) : undefined;
    if (parent && parent.key !== d.key) {
      const list = childrenOf.get(parent.key) ?? [];
      list.push(d);
      childrenOf.set(parent.key, list);
    } else {
      roots.push(d);
    }
  }

  const deleteRadius = new Map(
    deletes.map((del) => [keyAt(del.index), del.also] as const),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
      {/* canvas column */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <span className="block h-2 w-2 bg-primary" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-faint2">
                Changeset draft · {included.length} operation
                {included.length === 1 ? "" : "s"}
              </span>
            </div>
            <p className="m-0 max-w-[52ch] text-[17px] font-semibold leading-snug tracking-tight text-ink">
              {changeset.summary}
            </p>
            <p className="m-0 mt-1.5 text-[13px] text-muted">
              You asked: <span className="text-ink">“{intent}”</span>
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <button
              type="button"
              onClick={onFlipMode}
              className="text-[12.5px] text-muted underline underline-offset-2 hover:text-ink"
            >
              I meant to ask a question
            </button>
            {quotaLabel && (
              <span className="font-mono text-[10px] text-faint">
                {quotaLabel}
              </span>
            )}
          </div>
        </div>

        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragEnd={onDragEnd}
        >
          <div className="min-h-0 flex-1 overflow-auto rounded-[13px] border border-border bg-surface p-4">
            {roots.map((d) => (
              <NodeTree
                key={d.key}
                node={d}
                names={names}
                childrenOf={childrenOf}
                excluded={excluded}
                problems={problems}
                deleteRadius={deleteRadius}
                intent={intent}
                allDraft={draft}
                onToggle={(key) =>
                  setExcluded((x) => {
                    const next = new Set(x);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                onRename={(key, title) => {
                  const target = draft.find((dd) => dd.key === key);
                  if (target) patchOp(key, setTitle(target.op, title));
                }}
                onAddTask={addTaskUnder}
                onDrop={dropOp}
                onPatchSubtree={(keys, ops) =>
                  setDraft((ds) => {
                    const keep = ds.filter((dd) => !keys.includes(dd.key));
                    return [
                      ...keep,
                      ...ops.map((op) => ({ key: mintKey(), op })),
                    ];
                  })
                }
              />
            ))}
            {!draft.length && (
              <p className="m-0 py-8 text-center text-[13px] text-faint">
                Nothing left in this draft.
              </p>
            )}
          </div>
        </DndContext>
      </div>

      {/* summary rail */}
      <aside className="flex w-full shrink-0 flex-col gap-4 rounded-[13px] border border-border bg-surface2 p-4 lg:w-[264px]">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-faint2">
            Summary
          </span>
          <p className="m-0 mt-2 font-mono text-[12px] leading-relaxed text-ink">
            {counts.create} created · {counts.update} changed ·{" "}
            <span
              className={counts.delete ? "font-semibold text-tasks" : undefined}
            >
              {counts.delete} deleted
            </span>
          </p>
          {excluded.size > 0 && (
            <p className="m-0 mt-1 font-mono text-[10px] text-faint">
              {included.length} of {draft.length} selected
            </p>
          )}
        </div>

        {includedProblems.length > 0 && (
          <div className="rounded-[11px] border border-tasks bg-surface p-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-tasks">
              {includedProblems.length} problem
              {includedProblems.length === 1 ? "" : "s"}
            </span>
            <p className="m-0 mt-1.5 text-[12px] leading-snug text-muted">
              Fix or drop the flagged rows before applying.
            </p>
          </div>
        )}

        {includedDeletes.length > 0 && (
          <div className="rounded-[11px] border-[1.5px] border-tasks bg-surface p-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-tasks">
              Deletes · {includedDeletes.length}
            </span>
            <div className="mt-2 flex flex-col gap-1">
              {includedDeletes.map((d) => (
                <span key={d.key} className="text-[12.5px] text-ink">
                  {d.op.op === "delete"
                    ? `${d.op.entity} “${d.op.label}”`
                    : null}
                </span>
              ))}
            </div>
            <p className="m-0 mt-1.5 text-[11.5px] leading-snug text-muted">
              Deletions can&apos;t be undone.
            </p>
          </div>
        )}

        <div className="mt-auto flex flex-col gap-2">
          <button
            type="button"
            disabled={
              pending || !included.length || includedProblems.length > 0
            }
            onClick={() =>
              includedDeletes.length
                ? setPhase({ name: "confirming" })
                : apply()
            }
            className="w-full rounded-[10px] border-[1.5px] border-ink bg-ink px-3.5 py-2.5 text-[14px] font-bold text-background disabled:opacity-50"
          >
            {pending
              ? "Applying…"
              : `Apply ${included.length} operation${included.length === 1 ? "" : "s"}`}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onDiscard}
            className="w-full rounded-[10px] border-[1.5px] border-border bg-surface px-3.5 py-2.5 text-[14px] font-semibold text-ink hover:border-faint2"
          >
            Discard draft
          </button>
          <p className="m-0 text-center font-mono text-[10px] text-faint">
            nothing is saved until you apply
          </p>
        </div>
      </aside>

      {phase.name === "confirming" && (
        <ConfirmDeletes
          deletes={includedDeletes}
          radius={deleteRadius}
          pending={pending}
          onConfirm={apply}
          onWithout={applyWithoutDeletes}
          onBack={() => setPhase({ name: "editing" })}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One node + its subtree

function NodeTree(props: {
  node: DraftOp;
  names: Record<string, string>;
  childrenOf: Map<string, DraftOp[]>;
  excluded: Set<string>;
  problems: Map<string, string>;
  deleteRadius: Map<string | undefined, string[]>;
  intent: string;
  allDraft: DraftOp[];
  onToggle: (key: string) => void;
  onRename: (key: string, title: string) => void;
  onAddTask: (projectRef: string) => void;
  onDrop: (key: string) => void;
  onPatchSubtree: (keys: string[], ops: ChangeOp[]) => void;
}) {
  const { node, childrenOf } = props;
  const children = childrenOf.get(node.key) ?? [];
  const color = ENTITY_COLOR[node.op.entity];
  const isProject = node.op.entity === "project" && node.op.op !== "delete";

  return (
    <div
      className="mb-1.5"
      style={{ borderLeft: `2px solid ${color}`, paddingLeft: 14 }}
    >
      <NodeRow {...props} />
      {(children.length > 0 || isProject) && (
        <div className="mt-1.5 flex flex-col gap-1.5 pl-6">
          {children.map((child) => (
            <NodeTree key={child.key} {...props} node={child} />
          ))}
          {isProject && (
            <button
              type="button"
              onClick={() =>
                props.onAddTask(
                  node.op.op === "create"
                    ? node.op.refId
                    : (node.op as { id: string }).id,
                )
              }
              className="flex w-full items-center gap-2.5 rounded-[9px] border border-dashed border-border bg-surface2 px-3 py-2.5 text-left hover:border-faint2"
            >
              <Plus className="h-3 w-3 shrink-0 text-faint" />
              <span className="text-[13px] text-muted">
                Add the next step, you know the job better than I do
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function NodeRow({
  node,
  names,
  childrenOf,
  excluded,
  problems,
  deleteRadius,
  intent,
  allDraft,
  onToggle,
  onRename,
  onDrop,
  onPatchSubtree,
}: Parameters<typeof NodeTree>[0]) {
  const { op } = node;
  const isExcluded = excluded.has(node.key);
  const problem = problems.get(node.key);
  const color = ENTITY_COLOR[op.entity];
  const title = opTitle(op);
  const [renaming, setRenaming] = useState(op.op === "create" && !title);
  const [reprompting, setReprompting] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Right-click on desktop, long-press on touch — the same gesture people
  // already use for the tag menu elsewhere in the app.
  const openMenu = () => setMenuOpen(true);
  const startLongPress = () => {
    longPress.current = setTimeout(openMenu, 450);
  };
  const cancelLongPress = () => {
    if (longPress.current) clearTimeout(longPress.current);
    longPress.current = null;
  };
  useEffect(() => cancelLongPress, []);

  const draggable = useDraggable({
    id: node.key,
    disabled: op.op === "delete",
  });
  const droppable = useDroppable({
    id: node.key,
    disabled:
      op.entity === "task" || op.entity === "note" || op.op === "delete",
  });

  const subtreeKeys = useMemo(() => {
    const keys: string[] = [node.key];
    const walk = (k: string) => {
      for (const child of childrenOf.get(k) ?? []) {
        keys.push(child.key);
        walk(child.key);
      }
    };
    walk(node.key);
    return keys;
  }, [node.key, childrenOf]);

  const stateChip =
    op.op === "create" ? (
      <span
        className="rounded-[5px] border px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider"
        style={{ color, borderColor: color }}
      >
        New
      </span>
    ) : op.op === "update" ? (
      <span className="rounded-[5px] border border-border px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-muted">
        Changed
      </span>
    ) : (
      <span className="rounded-[5px] bg-tasks px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-white">
        Delete
      </span>
    );

  if (rewriting) {
    return (
      <div className="overflow-hidden rounded-[11px] border border-border bg-surface px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="block h-2 w-2 animate-pulse bg-primary" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-primary">
            Rewriting…
          </span>
        </div>
        <div className="mt-2.5 flex flex-col gap-1.5">
          <span className="h-2.5 w-[70%] rounded bg-hover" />
          <span className="h-2 w-[45%] rounded bg-hover" />
        </div>
      </div>
    );
  }

  return (
    <div ref={droppable.setNodeRef}>
      <div
        ref={draggable.setNodeRef}
        {...draggable.attributes}
        {...draggable.listeners}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu();
        }}
        onTouchStart={startLongPress}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        className={cn(
          "group rounded-[11px] border bg-surface px-3 py-2.5",
          op.op === "delete" ? "border-[1.5px] border-tasks" : "border-border",
          isExcluded && "border-dashed bg-surface2 opacity-55",
          droppable.isOver && "border-[1.5px] border-habits",
          draggable.isDragging &&
            "rotate-[-1.2deg] opacity-40 shadow-[1px_1px_0_var(--shadow)]",
        )}
      >
        <div className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={!isExcluded}
            aria-label="Include this operation"
            onChange={() => onToggle(node.key)}
            onPointerDown={(e) => e.stopPropagation()}
            className="mt-0.5 h-3.5 w-3.5 accent-[var(--ink)]"
          />
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span
                className="block h-2 w-2"
                style={{ background: isExcluded ? "var(--muted)" : color }}
              />
              <span className="font-mono text-[10px] uppercase tracking-widest text-faint2">
                {op.entity}
              </span>
              {stateChip}
            </div>

            {renaming ? (
              <input
                autoFocus
                defaultValue={title}
                placeholder="Name it…"
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  setRenaming(false);
                  const next = e.target.value.trim();
                  if (next && next !== title) onRename(node.key, next);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setRenaming(false);
                }}
                className="w-full max-w-[300px] rounded-[7px] border border-primary bg-surface2 px-2 py-1 text-[14px] font-semibold text-ink outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => op.op !== "delete" && setRenaming(true)}
                onPointerDown={(e) => e.stopPropagation()}
                className={cn(
                  "block max-w-full truncate text-left text-[14px] font-semibold tracking-tight text-ink",
                  op.op === "delete" &&
                    "cursor-default text-muted line-through decoration-tasks",
                )}
              >
                {title}
              </button>
            )}

            {op.op === "update" && <DiffGrid op={op} names={names} />}
            {op.op === "delete" &&
              (deleteRadius.get(node.key)?.length ?? 0) > 0 && (
                <div className="mt-1.5">
                  <p className="m-0 text-[12px] text-ink">Also deletes:</p>
                  <ul className="m-0 mt-1 list-disc pl-4 text-[12px] leading-relaxed text-muted">
                    {deleteRadius
                      .get(node.key)!
                      .slice(0, 5)
                      .map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    {deleteRadius.get(node.key)!.length > 5 && (
                      <li>
                        …and {deleteRadius.get(node.key)!.length - 5} more
                      </li>
                    )}
                  </ul>
                </div>
              )}
            {isExcluded && (
              <p className="m-0 mt-1 font-mono text-[11px] text-faint">
                won&apos;t be{" "}
                {op.op === "create"
                  ? "created"
                  : op.op === "update"
                    ? "changed"
                    : "deleted"}
              </p>
            )}
            {problem && !isExcluded && (
              <div className="mt-2 flex items-start gap-2 border-t border-border pt-2">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-tasks" />
                <div>
                  <p className="m-0 text-[12.5px] leading-snug text-ink">
                    {problem}
                  </p>
                  <button
                    type="button"
                    onClick={() => onDrop(node.key)}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="mt-1.5 rounded-lg border-[1.5px] border-border bg-surface px-2.5 py-1 text-[12px] text-ink hover:border-faint2"
                  >
                    Drop this op
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            aria-label={`Actions for ${title}`}
            onClick={(e) => {
              e.stopPropagation();
              openMenu();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex h-[22px] flex-none items-center gap-1 rounded-md border border-border bg-surface2 px-1.5 font-mono text-[9.5px] uppercase tracking-wider text-faint opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 max-lg:opacity-60"
          >
            <MoreHorizontal className="h-3 w-3" />
          </button>
        </div>
      </div>

      {menuOpen && (
        <NodeMenu
          title={title}
          excluded={isExcluded}
          canReprompt={op.op !== "delete"}
          onReprompt={() => {
            setMenuOpen(false);
            setReprompting(true);
          }}
          onRename={() => {
            setMenuOpen(false);
            setRenaming(true);
          }}
          onToggle={() => {
            setMenuOpen(false);
            onToggle(node.key);
          }}
          onRemove={() => {
            setMenuOpen(false);
            // Remove every op in the subtree: leaving orphaned children behind
            // is never what "remove this" means.
            subtreeKeys.forEach(onDrop);
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {reprompting && (
        <RepromptPopover
          subtreeKeys={subtreeKeys}
          allDraft={allDraft}
          intent={intent}
          onClose={() => setReprompting(false)}
          onStart={() => {
            setReprompting(false);
            setRewriting(true);
          }}
          onResult={(ops) => {
            setRewriting(false);
            if (ops) onPatchSubtree(subtreeKeys, ops);
          }}
        />
      )}
    </div>
  );
}

/** What each op field is called in the interface, per entity. */
function fieldLabel(field: string, entity: ChangeEntity): string {
  if (field === "title") return entity === "habit" ? "Name" : "Title";
  if (field === "description") return entity === "note" ? "Body" : "Details";
  if (field === "date") return entity === "goal" ? "Target date" : "Due";
  if (field === "projectId") return "Project";
  if (field === "goalId" || field === "goalIds") return "Goal";
  if (field === "tagNames") return "Tags";
  if (field === "lifeArea") return "Life area";
  if (field === "archived") return "Archived";
  if (field === "priority") return "Priority";
  if (field === "frequency") return "Repeats";
  return field;
}

/** old → new for the fields that genuinely differ. */
function DiffGrid({
  op,
  names,
}: {
  op: Extract<ChangeOp, { op: "update" }>;
  names: Record<string, string>;
}) {
  const before = op.before as Record<string, unknown>;
  const rows = Object.entries(op.fields).filter(([field, next]) => {
    if (next == null) return false;
    if (Array.isArray(next) && !next.length) return false;
    // The server strips echoed fields, but a draft edited by hand can
    // reintroduce one — never show "personal → personal".
    return !sameValue(next, before[field]);
  });
  if (!rows.length) return null;

  return (
    <div className="mt-2 flex flex-col gap-1">
      {rows.map(([field, next]) => (
        <div
          key={field}
          className="flex flex-wrap items-baseline gap-x-2 text-[12px]"
        >
          <span className="font-mono text-[10px] uppercase tracking-wider text-faint2">
            {fieldLabel(field, op.entity)}
          </span>
          <span className="text-faint line-through">
            {display(before[field], names)}
          </span>
          <span aria-hidden className="text-faint">
            →
          </span>
          <span className="font-medium text-ink">{display(next, names)}</span>
        </div>
      ))}
    </div>
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && [...a].sort().join() === [...b].sort().join()
    );
  }
  return a === b;
}

/** A field value as a person would write it — never raw JSON, never a hex id. */
function display(value: unknown, names: Record<string, string>): string {
  if (value == null || value === "") return "not set";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) {
    if (!value.length) return "none";
    return value.map((v) => names[String(v)] ?? String(v)).join(", ");
  }
  const str = String(value);
  // Ids mean nothing to a reader; show what they point at.
  if (names[str]) return names[str];
  // Timestamps: the day is the part anyone cares about.
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) return str.slice(0, 10);
  return str;
}

/**
 * What you can do to one node. Remove is a real removal — the op leaves the
 * draft — because unticking something you never wanted still leaves it on the
 * canvas, and a list of things you have to keep ignoring is worse than a
 * shorter list.
 */
function NodeMenu({
  title,
  excluded,
  canReprompt,
  onReprompt,
  onRename,
  onToggle,
  onRemove,
  onClose,
}: {
  title: string;
  excluded: boolean;
  canReprompt: boolean;
  onReprompt: () => void;
  onRename: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const away = () => onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // A frame's delay, or the click that opened it closes it again.
    const id = setTimeout(() => {
      window.addEventListener("click", away);
      window.addEventListener("keydown", esc);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("click", away);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const item =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-hover";

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="mt-1.5 w-full max-w-[260px] rounded-[11px] border border-border bg-surface p-1 shadow-[1px_1px_0_var(--shadow)]"
    >
      <p className="m-0 truncate px-2.5 py-1 font-mono text-[9.5px] uppercase tracking-widest text-faint2">
        {title}
      </p>
      {canReprompt && (
        <button type="button" onClick={onReprompt} className={item}>
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Change this with AI
        </button>
      )}
      {canReprompt && (
        <button type="button" onClick={onRename} className={item}>
          <Pencil className="h-3.5 w-3.5 text-faint" />
          Rename
        </button>
      )}
      <button type="button" onClick={onToggle} className={item}>
        {excluded ? (
          <Eye className="h-3.5 w-3.5 text-faint" />
        ) : (
          <EyeOff className="h-3.5 w-3.5 text-faint" />
        )}
        {excluded ? "Include again" : "Skip this one"}
      </button>
      <button
        type="button"
        onClick={onRemove}
        className={cn(item, "text-tasks hover:bg-tasks/10")}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Remove from draft
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node-scoped reprompt popover

function RepromptPopover({
  subtreeKeys,
  allDraft,
  intent,
  onClose,
  onStart,
  onResult,
}: {
  subtreeKeys: string[];
  allDraft: DraftOp[];
  intent: string;
  onClose: () => void;
  onStart: () => void;
  onResult: (ops: ChangeOp[] | null) => void;
}) {
  const [text, setText] = useState("");
  const childCount = subtreeKeys.length - 1;

  const submit = () => {
    const instruction = text.trim();
    if (!instruction) return;
    const subtree = allDraft
      .filter((d) => subtreeKeys.includes(d.key))
      .map((d) => d.op);
    const context = allDraft
      .filter((d) => !subtreeKeys.includes(d.key))
      .map((d) => `${d.op.entity}: ${opTitle(d.op)}`);
    onStart();
    void repromptNodeAction({ intent, instruction, subtree, context }).then(
      (res) => {
        if (!res.ok || !res.data) {
          toast.error((!res.ok && res.error) || "The rewrite failed");
          onResult(null);
          return;
        }
        onResult(res.data);
      },
    );
  };

  return (
    <div className="mt-1.5 rounded-[11px] border-[1.5px] border-primary bg-surface p-3 shadow-[1px_1px_0_var(--shadow)]">
      <div className="mb-2 flex items-center gap-2">
        <span className="block h-2 w-2 bg-primary" />
        <span className="font-mono text-[10px] uppercase tracking-widest text-primary">
          This node
          {childCount > 0
            ? ` + ${childCount} child${childCount === 1 ? "" : "ren"}`
            : ""}
        </span>
      </div>
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onClose();
        }}
        placeholder="rename, split into two, change the frequency…"
        className="w-full rounded-lg border border-border bg-surface2 px-2.5 py-2 text-[13px] text-ink outline-none focus:border-faint"
      />
      <div className="mt-2 flex items-center justify-between gap-2.5">
        <span className="font-mono text-[10px] text-faint">esc to close</span>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-bold text-background disabled:opacity-50"
        >
          Rewrite ↵
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm + applied

function ConfirmDeletes({
  deletes,
  radius,
  pending,
  onConfirm,
  onWithout,
  onBack,
}: {
  deletes: DraftOp[];
  radius: Map<string | undefined, string[]>;
  pending: boolean;
  onConfirm: () => void;
  onWithout: () => void;
  onBack: () => void;
}) {
  const total = deletes.reduce(
    (sum, d) => sum + 1 + (radius.get(d.key)?.length ?? 0),
    0,
  );
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-[420px] rounded-[13px] border-[1.5px] border-tasks bg-surface p-5 shadow-[1px_1px_0_var(--shadow)]">
        <span className="font-mono text-[10px] uppercase tracking-widest text-tasks">
          Permanent · {deletes.length} delete{deletes.length === 1 ? "" : "s"}
        </span>
        <p className="m-0 mt-2.5 text-[17px] font-bold tracking-tight text-ink">
          This removes {total} thing{total === 1 ? "" : "s"} for good.
        </p>
        <div className="mt-3 flex flex-col gap-1.5 rounded-[10px] border border-border bg-surface2 p-3">
          {deletes.map((d) => (
            <div key={d.key}>
              <span className="flex items-center gap-2 text-[13px] text-ink">
                <i
                  className="block h-2 w-2 shrink-0"
                  style={{ background: ENTITY_COLOR[d.op.entity] }}
                />
                {opTitle(d.op)}
                <span className="ml-auto font-mono text-[10px] text-faint">
                  {d.op.entity}
                </span>
              </span>
              {(radius.get(d.key) ?? []).slice(0, 5).map((t, i) => (
                <span
                  key={i}
                  className="mt-1 flex items-center gap-2 pl-4 text-[12.5px] text-muted"
                >
                  <i className="block h-1.5 w-1.5 shrink-0 bg-[var(--tasks)]" />
                  {t}
                </span>
              ))}
              {(radius.get(d.key)?.length ?? 0) > 5 && (
                <span className="mt-1 block pl-4 text-[12px] text-faint">
                  …and {radius.get(d.key)!.length - 5} more
                </span>
              )}
            </div>
          ))}
        </div>
        <p className="m-0 mt-3 text-[12.5px] leading-snug text-muted">
          The other operations are additions and edits, and those can be undone.
          Deletions cannot.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="min-w-[130px] flex-1 rounded-[10px] border-[1.5px] border-tasks bg-tasks px-3.5 py-2.5 text-[13.5px] font-bold text-white disabled:opacity-50"
          >
            Delete and apply
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onWithout}
            className="min-w-[130px] flex-1 rounded-[10px] border-[1.5px] border-border bg-surface px-3.5 py-2.5 text-[13.5px] font-semibold text-ink"
          >
            Apply without deletes
          </button>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="mt-2.5 w-full text-[12.5px] text-muted underline underline-offset-2"
        >
          Back to the canvas
        </button>
      </div>
    </div>
  );
}

const ENTITY_HREF: Record<ChangeEntity, (id: string) => string> = {
  task: (id) => `/tasks?task=${id}`,
  project: (id) => `/projects?project=${id}`,
  goal: (id) => `/goals?goal=${id}`,
  habit: (id) => `/habits?habit=${id}`,
  note: (id) => `/notes/${id}`,
  // A meeting has no page of its own; the calendar is where it lives, and the
  // day it is on is the useful place to land.
  meeting: () => `/calendar`,
};

function AppliedView({
  result,
  undone,
  pending,
  onUndo,
  onDone,
}: {
  result: ApplyChangesetResult;
  undone: boolean;
  pending: boolean;
  onUndo: () => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Check className="h-4 w-4 text-habits" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-habits">
            {undone ? "Undone" : `Applied · ${result.applied} operations`}
          </span>
        </div>
        <p className="m-0 text-[17px] font-semibold tracking-tight text-ink">
          {undone
            ? "Reverted. Deletions, if any, were already gone."
            : "It's in your PUMMA. Most of it is empty on purpose."}
        </p>
      </div>

      {!undone && result.created.length > 0 && (
        <div className="flex max-w-xl flex-col gap-2">
          {result.created.map((c) => (
            <Link
              key={c.id}
              href={ENTITY_HREF[c.entity](c.id)}
              className="flex items-center gap-2.5 rounded-[10px] border border-border bg-surface px-3 py-2.5 hover:border-faint2"
              style={{ borderLeft: `2px solid ${ENTITY_COLOR[c.entity]}` }}
            >
              <span
                className="block h-2 w-2 shrink-0"
                style={{ background: ENTITY_COLOR[c.entity] }}
              />
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">
                {c.title}
              </span>
              <span className="font-mono text-[10.5px] text-faint">open →</span>
            </Link>
          ))}
        </div>
      )}

      {result.skipped.length > 0 && (
        <div className="max-w-xl rounded-[11px] border border-border bg-surface2 p-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-faint2">
            Skipped · {result.skipped.length}
          </span>
          <ul className="m-0 mt-1.5 list-disc pl-4 text-[12.5px] text-muted">
            {result.skipped.map((s, i) => (
              <li key={i}>
                {s.label} · {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2 flex max-w-xl items-center gap-3 rounded-[11px] border border-border bg-surface px-3.5 py-3">
        <span className="min-w-0 flex-1 font-mono text-[10px] uppercase tracking-widest text-faint2">
          {undone ? "Nothing left to undo" : "Undo available for this session"}
        </span>
        {!undone && (
          <button
            type="button"
            disabled={pending}
            onClick={onUndo}
            className="rounded-lg border-[1.5px] border-border bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink hover:border-faint2 disabled:opacity-50"
          >
            Undo all
          </button>
        )}
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg bg-ink px-3 py-1.5 text-[13px] font-semibold text-background"
        >
          Done
        </button>
      </div>
    </div>
  );
}
