"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, Trash2, X } from "@/components/icons";
import type { Project, Tag, Task } from "@/lib/schemas";
import {
  bulkDeleteTasks,
  bulkUpdateTasks,
  undoDeleteTasks,
} from "@/lib/actions/tasks";
import { DueQuickPick } from "@/components/shell/DueQuickPick";
import { tagBg } from "@/lib/parse";
import { isLifeTag } from "@/lib/life-area-sync";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS = [
  ["todo", "To do"],
  ["doing", "Doing"],
  ["done", "Done"],
] as const;

// The shared tokens. Low was `var(--border)`, which is ALSO the inactive
// border and the inactive background, so a selected Low was pixel-identical
// to an unselected one and its dot was invisible against the chip. Every
// other surface gets Low's blue from --prio-low; so does this one.
const PRIORITY_OPTIONS = [
  ["low", "Low", "var(--prio-low)"],
  ["med", "Med", "var(--prio-med)"],
  ["high", "High", "var(--prio-high)"],
] as const;

/** The fields a batch can share. Mirrors bulkUpdateTasks minus the ids. */
type BulkPatch = {
  priority?: Task["priority"];
  status?: Task["status"];
  projectId?: string | null;
  due?: string | null;
  addTagIds?: string[];
  removeTagIds?: string[];
};

type Props = {
  tasks: Task[];
  tags: Tag[];
  projects: Project[];
  /** Called after a change lands, so the view can drop the selection. */
  onClear: () => void;
  /** Deleting takes the rows away; the selection must go with them. */
  onDeleted?: () => void;
};

/**
 * What the right pane becomes while several tasks are selected.
 *
 * Only shows what can honestly be applied to many rows at once: a title or a
 * description would have to overwrite every one of them with the same string,
 * which is never what anybody means. Everything here is a single value the
 * whole batch can share, plus tags, which merge instead of replacing.
 */
export function BulkEditPanel({
  tasks,
  tags,
  projects,
  onClear,
  onDeleted,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ids = tasks.map((t) => t.id);

  /** A field's value when every selected task agrees, else null. */
  const shared = <K extends keyof Task>(key: K): Task[K] | null => {
    if (!tasks.length) return null;
    const first = tasks[0][key];
    return tasks.every((t) => t[key] === first) ? first : null;
  };

  const sharedStatus = shared("status");
  const sharedPriority = shared("priority");
  const sharedProject = shared("projectId");
  // The placeholder needs a value of its own: "" already means "No project",
  // and two options sharing a value means picking the real one fires no
  // change event at all.
  const MIXED = "__mixed__";
  const mixedProject = sharedProject === null && tasks.length > 1;

  // Tags are three-state across a selection: on all, on some, on none. The
  // middle case is the whole reason this isn't a plain checkbox list — a
  // half-tick has to mean "leave the ones that have it alone".
  const tagState = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tasks) {
      for (const id of t.tagIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return (tagId: string): "all" | "some" | "none" => {
      const n = counts.get(tagId) ?? 0;
      if (!n) return "none";
      return n === tasks.length ? "all" : "some";
    };
  }, [tasks]);

  const listedTags = useMemo(
    () => tags.filter((t) => !t.projectId && !isLifeTag(t.name)),
    [tags],
  );
  const lifeTags = useMemo(() => tags.filter((t) => isLifeTag(t.name)), [tags]);

  const apply = (patch: BulkPatch, describe: string) => {
    startTransition(async () => {
      const res = await bulkUpdateTasks({ ids, ...patch });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const n = res.data?.updated ?? ids.length;
      toast.success(`${n} ${n === 1 ? "task" : "tasks"} ${describe}`);
      router.refresh();
    });
  };

  const toggleTag = (tag: Tag) => {
    const state = tagState(tag.id);
    // Partly-applied goes to fully-applied first: the useful move on a mixed
    // selection is almost always "give them all this tag".
    if (state === "all") {
      apply({ removeTagIds: [tag.id] }, `untagged ${tag.name}`);
    } else {
      apply({ addTagIds: [tag.id] }, `tagged ${tag.name}`);
    }
  };

  const handleDelete = () => {
    startTransition(async () => {
      const res = await bulkDeleteTasks({ ids });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const n = res.data?.deleted ?? ids.length;
      const snapshot = res.undo ? JSON.stringify(res.undo.snapshot) : null;
      (onDeleted ?? onClear)();
      toast.success(`${n} ${n === 1 ? "task" : "tasks"} deleted`, {
        action: snapshot
          ? {
              label: "UNDO",
              onClick: async () => {
                await undoDeleteTasks(snapshot);
                router.refresh();
              },
            }
          : undefined,
      });
      router.refresh();
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border2 px-4 py-3.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold leading-none text-ink">
                {tasks.length}
              </span>
              <span className="text-[13px] font-semibold text-ink">
                {tasks.length === 1 ? "task selected" : "tasks selected"}
              </span>
            </div>
            <p className="m-0 mt-1.5 font-mono text-[10px] leading-relaxed text-faint">
              ⌘/ctrl-click to add · shift-click for a range
            </p>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-faint transition-colors hover:bg-hover hover:text-ink"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <Section label="Status">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_OPTIONS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                disabled={pending}
                onClick={() => apply({ status: value }, `moved to ${label}`)}
                className={cn(
                  "rounded-md border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wide transition-colors disabled:opacity-50",
                  sharedStatus === value
                    ? "border-ink bg-ink text-background"
                    : "border-border bg-surface2 text-faint hover:border-faint hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>

        <Section label="Priority">
          <div className="flex gap-1.5">
            {PRIORITY_OPTIONS.map(([value, label, color]) => {
              const active = sharedPriority === value;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={pending}
                  onClick={() => apply({ priority: value }, `set to ${label}`)}
                  className={cn(
                    // Same non-flicker recipe as the detail panel: constant
                    // 1px border, the second pixel painted inside as a
                    // shadow, and a transition that names its properties.
                    "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wide transition-[color,background-color,border-color,box-shadow] duration-150 disabled:opacity-50",
                    active
                      ? "animate-chip-pick text-ink"
                      : "border-border bg-surface2 text-faint hover:border-faint",
                  )}
                  style={
                    active
                      ? {
                          borderColor: color,
                          // color-mix, not tagBg: that expects a literal
                          // colour and cannot see through a var().
                          background: `color-mix(in oklab, ${color} 14%, transparent)`,
                          boxShadow: `inset 0 0 0 1px ${color}, 1px 1px 0 var(--shadow)`,
                        }
                      : undefined
                  }
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: color }}
                  />
                  {label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section label="Due date">
          <DueQuickPick
            mode="due-optional"
            value={null}
            disabled={pending}
            onChange={(next) => {
              if (!next) {
                apply({ due: null }, "cleared of a due date");
                return;
              }
              // One date for the whole batch, with no time of day: the tasks
              // may each have had a different one, and there's no single time
              // that would be right for all of them.
              apply({ due: next }, `due ${next}`);
            }}
          />
        </Section>

        <Section label="Project">
          <select
            value={mixedProject ? MIXED : (sharedProject ?? "")}
            disabled={pending}
            onChange={(e) => {
              if (e.target.value === MIXED) return;
              const next = e.target.value || null;
              const title = next
                ? (projects.find((p) => p.id === next)?.title ?? "project")
                : "no project";
              apply({ projectId: next }, `moved to ${title}`);
            }}
            className="w-full truncate rounded-lg border border-border bg-surface px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-faint disabled:opacity-50"
            aria-label="Move selected tasks to a project"
          >
            {mixedProject && <option value={MIXED}>(mixed)</option>}
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Section>

        {lifeTags.length > 0 && (
          <Section label="Life area">
            <div className="flex flex-wrap gap-1.5">
              {lifeTags.map((tag) => (
                <TagToggle
                  key={tag.id}
                  tag={tag}
                  state={tagState(tag.id)}
                  disabled={pending}
                  onClick={() => toggleTag(tag)}
                />
              ))}
            </div>
          </Section>
        )}

        <Section label="Tags">
          {listedTags.length ? (
            <div className="flex flex-wrap gap-1.5">
              {listedTags.map((tag) => (
                <TagToggle
                  key={tag.id}
                  tag={tag}
                  state={tagState(tag.id)}
                  disabled={pending}
                  onClick={() => toggleTag(tag)}
                />
              ))}
            </div>
          ) : (
            <p className="m-0 font-mono text-[10px] text-faint2">
              No tags yet. Add one from the sidebar.
            </p>
          )}
          <p className="m-0 mt-2 font-mono text-[10px] leading-relaxed text-faint2">
            A half-filled tag is on some of them. Clicking gives it to all;
            clicking a full one takes it off all.
          </p>
        </Section>

        <div className="mt-5 border-t border-border2 pt-4">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={handleDelete}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-tasks px-3 py-2 text-[12.5px] font-bold text-white transition-opacity disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete {tasks.length}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-border px-3 py-2 text-[12.5px] text-muted hover:border-faint hover:text-ink"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmDelete(true)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-tasks/40 px-3 py-2 text-[12.5px] font-semibold text-tasks transition-colors hover:bg-tasks/10 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4">
      <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
        {label}
      </h4>
      {children}
    </section>
  );
}

function TagToggle({
  tag,
  state,
  disabled,
  onClick,
}: {
  tag: Tag;
  state: "all" | "some" | "none";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={state === "all"}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-[11px] transition-all disabled:opacity-50",
        state === "none"
          ? "border-border bg-surface text-muted hover:border-faint2"
          : "border-2 font-semibold",
      )}
      style={
        state === "none"
          ? undefined
          : {
              borderColor: tag.color,
              background: tagBg(tag.color),
              color: tag.color,
            }
      }
    >
      <span
        className="flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border"
        style={{
          borderColor: tag.color,
          background: state === "all" ? tag.color : "transparent",
        }}
      >
        {state === "all" && (
          <Check className="h-2 w-2 text-white" strokeWidth={4} />
        )}
        {state === "some" && (
          <Minus
            className="h-2 w-2"
            strokeWidth={4}
            style={{ color: tag.color }}
          />
        )}
      </span>
      {tag.name}
    </button>
  );
}
