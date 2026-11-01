"use client";

import {
  useCallback,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Plus, X } from "@/components/icons";
import type { Project, Subtask, Tag, Task } from "@/lib/schemas";
import { oid, taskDueDateInput } from "@/lib/date";
import {
  changeTaskSubtask,
  updateTaskDetail,
  moveTaskStatus,
  setTaskProject,
} from "@/lib/actions/tasks";
import { toggleEntityTag } from "@/lib/actions/tags";
import { TagGridPicker } from "@/components/tags/TagGridPicker";
import { TaskTimer } from "@/components/tasks/TaskTimer";
import { DueQuickPick } from "@/components/shell/DueQuickPick";
import { ScrollHint } from "@/components/ui/scroll-hint";
import { EditableTitle } from "@/components/ui/editable-title";
import { cn } from "@/lib/utils";
import { useSyncedDraft } from "@/lib/use-synced-draft";
import { useAutosaveDraft } from "@/lib/use-autosave-draft";
import { trySave } from "@/lib/try-save";
import { useTrySave } from "@/lib/use-try-save";
import { applySubtaskChange, type SubtaskChange } from "@/lib/subtask-changes";

const STATUS_OPTIONS = [
  ["todo", "To do"],
  ["doing", "Doing"],
  ["done", "Done"],
] as const;

// The shared tokens, not a third private copy of the palette. Low was
// `var(--border)` here, which is also the inactive border and inactive
// background — so selecting Low produced a chip identical to an unselected
// one, and the dot beside it was invisible. Low has a colour of its own
// (the blue) everywhere else in the app; it has one here now too.
const PRIORITY_OPTIONS = [
  ["low", "Low", "var(--prio-low)"],
  ["med", "Med", "var(--prio-med)"],
  ["high", "High", "var(--prio-high)"],
] as const;

type Props = {
  task: Task;
  tags: Tag[];
  projects: Project[];
  onClose: () => void;
  embedded?: boolean;
  /** When set, the header shows a back arrow (top-left) instead of the X —
   *  used when this panel replaces another panel in place (Projects view). */
  onBack?: { label: string; action: () => void };
};

function dueTimeOf(due: string | null): string {
  return due?.includes("T") ? due.slice(11, 16) : "";
}

/** One checklist row. Its title draft lives only while the input has focus, so a title changed elsewhere still shows. */
function SubtaskRow({
  sub,
  onChange,
}: {
  sub: Subtask;
  onChange: (change: SubtaskChange) => void;
}) {
  const [draft, setDraft] = useState<{ from: string; value: string } | null>(
    null,
  );

  const commitTitle = (value: string) => {
    const from = draft?.from ?? sub.title;
    setDraft(null);
    if (value === from) return;
    const title = value.trim();
    if (!title) onChange({ kind: "remove", id: sub.id });
    else if (title !== from) onChange({ kind: "rename", id: sub.id, title });
  };

  return (
    <div className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface2/70">
      <button
        type="button"
        onClick={() =>
          onChange({ kind: "setDone", id: sub.id, done: !sub.done })
        }
        className={cn(
          "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.8px]",
          sub.done
            ? "border-none bg-habits"
            : "border-border bg-transparent",
        )}
      >
        {sub.done && (
          <Check
            className="h-[10px] w-[10px] text-white"
            strokeWidth={3.2}
          />
        )}
      </button>
      <input
        value={draft?.value ?? sub.title}
        onFocus={() => setDraft({ from: sub.title, value: sub.title })}
        onChange={(e) =>
          setDraft({ from: draft?.from ?? sub.title, value: e.target.value })
        }
        onBlur={(e) => commitTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={cn(
          // Same tell as the titles above, minus the pencil.
          "-mx-1 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[13px] outline-none transition-colors hover:border-border focus:border-faint focus:bg-background/50",
          sub.done ? "text-faint2 line-through" : "text-ink",
        )}
      />
    </div>
  );
}

export function TaskDetailPanel({
  task,
  tags,
  projects,
  onClose,
  embedded = false,
  onBack,
}: Props) {
  const router = useRouter();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [title, setTitle, flushTitle, cancelTitle] = useAutosaveDraft(
    task.title,
    task.id,
    useCallback(
      (id: string, value: string) => updateTaskDetail({ id, title: value }),
      [],
    ),
    { delay: null, required: true },
  );
  const [storedSubtasks, setStoredSubtasks] = useSyncedDraft(
    task.subtasks,
    task.id,
  );
  const [subtasks, applyLocally] = useOptimistic(
    storedSubtasks,
    (list: Subtask[], change: SubtaskChange) =>
      applySubtaskChange(list, change) ?? list,
  );
  const [tagIds, setTagIds] = useSyncedDraft(task.tagIds, task.id);
  const [newSubtask, setNewSubtask] = useState("");
  const [status, setStatus] = useSyncedDraft(task.status, task.id);
  const [priority, setPriority] = useSyncedDraft(task.priority, task.id);
  const [dueDate, setDueDate] = useSyncedDraft(
    taskDueDateInput(task.due),
    task.id,
  );
  const [dueTime, setDueTime] = useSyncedDraft(dueTimeOf(task.due), task.id);
  const [pending, startTransition] = useTransition();
  const attempt = useTrySave();

  const project = projects.find((p) => p.id === task.projectId);

  const moveToProject = (projectId: string | null) => {
    startTransition(async () => {
      const res = await trySave(() =>
        setTaskProject({ id: task.id, projectId }),
      );
      if (res) router.refresh();
    });
  };

  const persist = useCallback(
    (
      patch: {
        priority?: Task["priority"];
        due?: null;
        dueDate?: string;
        dueTime?: string | null;
      },
      onFail: () => void,
    ) => {
      startTransition(async () => {
        // No router.refresh(). Every one of these actions ends in
        // revalidatePath("/", "layout"), and Next returns the re-rendered tree
        // with the action's own response — so the refresh was a second full
        // round-trip for data we had already been sent.
        //
        // It is not just wasted: revalidating the root layout empties the
        // client router cache for every route, so each refresh made the
        // sidebar re-prefetch all nine of its links. This is the panel's hot
        // path — it fires on every debounced keystroke in the description and
        // on every field change.
        await attempt(() => updateTaskDetail({ id: task.id, ...patch }), onFail);
      });
    },
    [task.id, attempt],
  );

  // Autosaves, and survives closing the panel / switching tasks mid-sentence.
  const [description, setDescription, flushDescription] = useAutosaveDraft(
    task.description,
    task.id,
    useCallback(
      (id: string, value: string) =>
        updateTaskDetail({ id, description: value }),
      [],
    ),
  );

  // Closing commits any pending description first. The unmount cleanup above is
  // a backstop, but an action fired while the tree is being torn down inside a
  // router transition can be dropped — doing it here keeps the component alive
  // for the call.
  const handleClose = useCallback(() => {
    flushDescription();
    onClose();
  }, [flushDescription, onClose]);

  const changeSubtask = (change: SubtaskChange, onFail?: () => void) => {
    startTransition(async () => {
      applyLocally(change);
      const res = await attempt(
        () => changeTaskSubtask({ id: task.id, change }),
        onFail,
      );
      // What the server says now, so a page thrown away by a URL write can't flip the box back.
      if (res?.ok && res.data) setStoredSubtasks(res.data);
    });
  };

  const addSubtask = () => {
    const title = newSubtask.trim();
    if (!title) return;
    setNewSubtask("");
    changeSubtask({ kind: "add", id: oid(), title }, () =>
      setNewSubtask((typed) => typed || title),
    );
  };

  const toggleTag = (tagId: string) => {
    const apply = !tagIds.includes(tagId);
    startTransition(async () => {
      const res = await trySave(() =>
        toggleEntityTag("task", task.id, tagId, apply),
      );
      if (!res) return;
      setTagIds((prev) =>
        apply
          ? [...prev.filter((id) => id !== tagId), tagId]
          : prev.filter((id) => id !== tagId),
      );
      // A project tag rewrites projectId and strips the old project's tags, so
      // the server's version is the one to believe.
      router.refresh();
    });
  };

  const setTaskStatus = (next: Task["status"]) => {
    setStatus(next);
    startTransition(async () => {
      const res = await trySave(
        () => moveTaskStatus(task.id, next),
        () => setStatus(task.status),
      );
      if (res) router.refresh();
    });
  };

  const setTaskPriority = (next: Task["priority"]) => {
    setPriority(next);
    persist({ priority: next }, () => setPriority(task.priority));
  };

  const revertDue = () => {
    setDueDate(taskDueDateInput(task.due));
    setDueTime(dueTimeOf(task.due));
  };

  const clearDueDate = () => {
    if (!dueDate) return;
    setDueDate("");
    setDueTime("");
    persist({ due: null }, revertDue);
  };

  // A time only means anything once there's a date it belongs to, and the
  // omnibar deliberately never sets one (see lib/parse.ts). This is the only
  // place a task picks up a time of day, and it can always be cleared back
  // to a plain due date.
  const setTaskTime = (next: string) => {
    if (!dueDate || next === dueTime) return;
    setDueTime(next);
    persist({ dueTime: next || null }, revertDue);
  };

  const doneSubtasks = subtasks.filter((s) => s.done).length;
  const subtaskPct = subtasks.length
    ? Math.round((doneSubtasks / subtasks.length) * 100)
    : 0;

  return (
    <aside
      className={cn(
        "relative flex h-full min-h-0 flex-col overflow-hidden bg-surface",
        embedded
          ? "rounded-none border-0 shadow-none"
          : "rounded-[13px] border border-border",
      )}
      style={embedded ? undefined : { boxShadow: "2px 2px 0 var(--shadow)" }}
    >
      <header
        className={cn(
          "border-b border-border2 bg-surface2/60 px-4 py-3",
          // In a bottom sheet the head is the top of the screen, so it stays
          // plain and lets the grab pill be the only colour there.
          embedded && "panel-head-plain",
        )}
      >
        {onBack && (
          <button
            type="button"
            onClick={() => {
              flushDescription();
              onBack.action();
            }}
            className="group mb-2 flex items-center gap-1.5 rounded-md py-0.5 pr-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-faint transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
            {onBack.label}
          </button>
        )}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <EditableTitle
              value={title}
              onChange={setTitle}
              onCommit={flushTitle}
              onCancel={cancelTitle}
              placeholder="Task title"
              ariaLabel="Task title"
              className="text-lg font-bold text-ink"
            />
            <div className="mt-1.5 flex flex-wrap gap-2 font-mono text-[10px] text-faint">
              {project && (
                <span className="flex items-center gap-1">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: project.color }}
                  />
                  {project.title}
                </span>
              )}
            </div>
          </div>
          {!onBack && (
            <button
              type="button"
              onClick={handleClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-faint transition-colors hover:bg-hover hover:text-ink"
              aria-label="Close task detail"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {STATUS_OPTIONS.map(([value, label]) => {
            const active = status === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTaskStatus(value)}
                className={cn(
                  "rounded-md border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wide transition-colors",
                  active
                    ? "border-ink bg-ink text-background"
                    : "border-border bg-surface2 text-faint hover:border-faint hover:text-ink",
                )}
              >
                {label}
              </button>
            );
          })}
          <div className="ml-auto">
            <TaskTimer task={task} />
          </div>
        </div>

        <section className="mb-4">
          <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            Due date
          </h4>
          <DueQuickPick
            mode="due-optional"
            value={dueDate || null}
            onChange={(next) => {
              if (!next) {
                clearDueDate();
                return;
              }
              if (next === dueDate) return;
              setDueDate(next);
              persist({ dueDate: next }, revertDue);
            }}
          />
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-faint2">
              Time
            </span>
            <input
              type="time"
              value={dueTime}
              disabled={!dueDate}
              onChange={(e) => setTaskTime(e.target.value)}
              aria-label="Due time"
              className="rounded-lg border border-border bg-surface px-2 py-1 font-mono text-[11px] text-ink outline-none transition-colors focus:border-faint disabled:opacity-50"
            />
            {dueTime && (
              <button
                type="button"
                onClick={() => setTaskTime("")}
                className="font-mono text-[10px] text-faint hover:text-ink"
              >
                Clear
              </button>
            )}
          </div>
          {!dueDate && (
            <p className="mt-1.5 font-mono text-[10px] text-faint">
              Set a due date to add a time
            </p>
          )}
        </section>

        <section className="mb-4">
          <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            Priority
          </h4>
          <div className="flex gap-1.5">
            {PRIORITY_OPTIONS.map(([value, label, color]) => {
              const active = priority === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTaskPriority(value)}
                  className={cn(
                    // Border width is LAYOUT. Going 1px -> 2px on the active
                    // chip grew the box, compacted the row for a frame and
                    // made the outer edge pulse inward — the same flicker the
                    // date chips had. The border stays 1px in both states and
                    // the second pixel is painted INSIDE with a shadow, which
                    // is not layout and cannot move anything.
                    //
                    // The transition names its properties too: transition-all
                    // would try to animate the shadow appearing, which is the
                    // other half of what the flicker looked like.
                    "flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wide transition-[color,background-color,border-color,box-shadow] duration-150",
                    active
                      ? "animate-chip-pick text-ink"
                      : "border-border bg-surface2 text-faint hover:border-faint",
                  )}
                  // color-mix rather than string-surgery on the colour: the
                  // old `.replace(")", " / 0.12)")` only worked on a literal
                  // oklch() and silently fell through to a plain surface for
                  // anything else, which is how Low ended up with no tint.
                  style={
                    active
                      ? {
                          borderColor: color,
                          background: `color-mix(in oklab, ${color} 14%, transparent)`,
                          boxShadow: `inset 0 0 0 1px ${color}, 1px 1px 0 var(--shadow)`,
                        }
                      : undefined
                  }
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: color }}
                  />
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="mb-4">
          <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            Project
          </h4>
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-[3px] transition-colors"
              /* `--border` is a hairline, not a swatch: on a light theme the
                 dot disappeared entirely and "No project" started flush left
                 while every real project sat one dot-width in. `--faint2` is
                 what the task list already uses for the same bucket. */
              style={{ background: project?.color ?? "var(--faint2)" }}
              aria-hidden
            />
            <select
              value={task.projectId ?? ""}
              disabled={pending}
              onChange={(e) => moveToProject(e.target.value || null)}
              aria-label="Project"
              className="min-w-0 flex-1 truncate rounded-lg border border-border bg-surface px-2 py-1.5 text-[12.5px] text-ink outline-none transition-colors focus:border-faint disabled:opacity-50"
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="mb-5">
          <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            Description
          </h4>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={flushDescription}
            placeholder="Add notes, context, links…"
            rows={4}
            className="w-full resize-y rounded-lg border border-border bg-surface2/50 px-3 py-2.5 text-[13px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint2 focus:border-faint"
          />
        </section>

        <section className="mb-5">
          <div className="mb-2 flex items-center gap-2">
            <h4 className="m-0 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
              Subtasks
            </h4>
            {subtasks.length > 0 && (
              <span className="font-mono text-[9px] text-faint2">
                {doneSubtasks}/{subtasks.length}
              </span>
            )}
          </div>
          {subtasks.length > 0 && (
            <div className="mb-2 h-1 overflow-hidden rounded-full bg-border2">
              <div
                className="h-full rounded-full bg-habits transition-[width] duration-200"
                style={{ width: `${subtaskPct}%` }}
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            {subtasks.map((sub) => (
              <SubtaskRow
                key={sub.id}
                sub={sub}
                onChange={(change) => changeSubtask(change)}
              />
            ))}
            <div className="mt-1 flex items-center gap-2 rounded-lg border border-dashed border-border px-2 py-1.5">
              <Plus className="h-3.5 w-3.5 shrink-0 text-faint2" />
              <input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSubtask();
                  }
                }}
                placeholder="Add subtask…"
                className="min-w-0 flex-1 border-none bg-transparent p-0 text-[13px] text-ink outline-none placeholder:text-faint2"
              />
            </div>
          </div>
        </section>

        <section>
          <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            Tags
          </h4>
          <TagGridPicker
            tags={tags}
            selectedTagIds={tagIds}
            onToggle={toggleTag}
            projects={projects}
            projectId={task.projectId}
          />
        </section>
      </div>
      <ScrollHint targetRef={bodyRef} direction="down" />
    </aside>
  );
}
