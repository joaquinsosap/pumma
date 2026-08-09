"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "@/components/icons";
import type { Goal, Project, Tag, Task } from "@/lib/schemas";
import { projectProgress } from "@/lib/metrics";
import {
  updateProjectDetail,
  deleteProjectAction,
} from "@/lib/actions/projects";
import { linkProjectToGoal } from "@/lib/actions/links";
import { GoalLinkField } from "@/components/links/GoalLinkField";
import { ProjectTagsField } from "@/components/projects/ProjectTagsField";
import { EntityTagRow } from "@/components/tags/EntityTagRow";
import { PROJECT_COLORS } from "@/lib/project-colors";
import { cn } from "@/lib/utils";
import { useSyncedDraft } from "@/lib/use-synced-draft";
import { useAutosaveDraft } from "@/lib/use-autosave-draft";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollHint } from "@/components/ui/scroll-hint";
import { EditableTitle } from "@/components/ui/editable-title";
import { toast } from "sonner";

type Props = {
  project: Project;
  goals: Goal[];
  tasks: Task[];
  tags: Tag[];
  onDeleted?: () => void;
};

export function ProjectDetailPanel({
  project,
  goals,
  tasks,
  tags,
  onDeleted,
}: Props) {
  const router = useRouter();
  const confirm = useConfirm();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useSyncedDraft(project.title, project.id);
  const [color, setColor] = useSyncedDraft(project.color, project.id);
  const [, startTransition] = useTransition();

  const prog = projectProgress(project.id, tasks);
  const openTasks = tasks.filter(
    (t) => t.projectId === project.id && t.status !== "done",
  ).length;

  const persist = useCallback(
    (patch: { title?: string; description?: string; color?: string }) => {
      startTransition(async () => {
        await updateProjectDetail({ id: project.id, ...patch });
        router.refresh();
      });
    },
    [project.id, router],
  );

  // Autosaves, and survives closing the panel / switching project mid-sentence.
  const [description, setDescription, flushDescription] = useAutosaveDraft(
    project.description,
    project.id,
    useCallback(
      (id: string, value: string) =>
        void updateProjectDetail({ id, description: value }),
      [],
    ),
  );

  const saveTitle = () => {
    const next = title.trim();
    if (next === project.title) return;
    if (!next) return;
    persist({ title: next });
  };

  const [deleteOpen, setDeleteOpen] = useState(false);
  const taskCount = tasks.filter((t) => t.projectId === project.id).length;

  const runDelete = (deleteTasks: boolean) => {
    setDeleteOpen(false);
    startTransition(async () => {
      const res = await deleteProjectAction(project.id, { deleteTasks });
      if (!res.ok) {
        toast.error(res.error ?? "Could not delete project");
        return;
      }
      toast.success(
        deleteTasks && taskCount > 0
          ? `Project + ${taskCount} task${taskCount === 1 ? "" : "s"} deleted`
          : "Project deleted",
      );
      onDeleted?.();
      router.refresh();
    });
  };

  const handleDelete = async () => {
    // No linked tasks → nothing to decide, plain confirm is enough.
    if (taskCount === 0) {
      const ok = await confirm({
        title: `Delete "${project.title}"?`,
        confirmLabel: "Delete",
        destructive: true,
      });
      if (ok) runDelete(false);
      return;
    }
    setDeleteOpen(true);
  };

  return (
    <aside
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[13px] border border-border bg-surface max-lg:shrink-0"
      style={{ boxShadow: "2px 2px 0 var(--shadow)" }}
    >
      <header className="border-b border-border2 bg-surface2/60 px-4 py-3">
        <EditableTitle
          value={title}
          onChange={setTitle}
          onCommit={saveTitle}
          onCancel={() => setTitle(project.title)}
          placeholder="Project title"
          ariaLabel="Project title"
          className="text-lg font-bold text-ink"
        />
        <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-faint">
          <span>
            <span className="font-semibold text-ink">{prog.label}</span> tasks
            done
          </span>
          <span>{openTasks} open</span>
          <span className="font-semibold text-ink">{prog.progress}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border2">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${prog.progress}%`, background: color }}
          />
        </div>
      </header>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <section className="mb-5">
          <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            Description
          </h4>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={flushDescription}
            placeholder="Goals, scope, links, context…"
            rows={5}
            className="w-full resize-y rounded-lg border border-border bg-surface2/50 px-3 py-2.5 text-[13px] leading-relaxed text-ink outline-none transition-colors placeholder:text-faint2 focus:border-faint"
          />
        </section>

        <section className="mb-5">
          <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            Tags
          </h4>
          <EntityTagRow
            entity="project"
            entityId={project.id}
            tags={tags}
            selectedTagIds={project.tagIds}
          />
          <p className="m-0 mt-1.5 text-[11px] leading-relaxed text-faint">
            Personal or work — switching takes this project&apos;s tasks with
            it.
          </p>
        </section>

        <section className="mb-5">
          <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            Color
          </h4>
          <div className="flex flex-wrap gap-2">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title="Set project color"
                onClick={() => {
                  setColor(c);
                  persist({ color: c });
                }}
                className={cn(
                  "h-7 w-7 rounded-lg border-2 transition-transform hover:scale-105",
                  color === c ? "border-ink" : "border-transparent",
                )}
                style={{ background: c }}
              />
            ))}
          </div>
        </section>

        <section>
          <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            Task tags
          </h4>
          <ProjectTagsField project={project} tags={tags} />
        </section>

        <section>
          <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
            Linked goal
          </h4>
          <GoalLinkField
            goals={goals}
            value={project.goalId}
            onChange={(goalId) =>
              startTransition(async () => {
                const res = await linkProjectToGoal(project.id, goalId);
                if (!res.ok) toast.error(res.error ?? "Could not link goal");
                router.refresh();
              })
            }
          />
        </section>

        <section className="pt-1">
          <button
            type="button"
            onClick={handleDelete}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-tasks/30 bg-tasks/[0.06] px-3 py-2 text-[13px] font-semibold text-tasks transition-colors hover:border-tasks/50 hover:bg-tasks/10"
          >
            <Trash2 className="h-4 w-4" />
            Delete project
          </button>
        </section>
      </div>
      <ScrollHint targetRef={bodyRef} direction="down" />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent
          className="max-w-[420px] gap-0 rounded-[13px] p-0"
          style={{ boxShadow: "2px 2px 0 var(--shadow)" }}
        >
          <div className="border-b border-border2 bg-surface2/60 px-5 py-4">
            <DialogHeader className="gap-1">
              <DialogTitle className="text-base font-extrabold tracking-tight">
                Delete &quot;{project.title}&quot;?
              </DialogTitle>
            </DialogHeader>
            <p className="m-0 mt-1 text-[13px] leading-relaxed text-muted">
              It has {taskCount} task{taskCount === 1 ? "" : "s"}. Keep them as
              standalone tasks, or delete them along with the project.
            </p>
          </div>
          <div className="flex flex-col gap-2 px-5 py-4">
            <button
              type="button"
              onClick={() => runDelete(false)}
              className="w-full rounded-lg border border-border px-3 py-2 text-[13px] font-semibold text-ink transition-colors hover:border-faint2 hover:bg-hover"
            >
              Delete project, keep tasks
            </button>
            <button
              type="button"
              onClick={() => runDelete(true)}
              className="w-full rounded-lg border border-tasks/40 bg-tasks/10 px-3 py-2 text-[13px] font-semibold text-tasks transition-colors hover:border-tasks/60 hover:bg-tasks/15"
            >
              Delete project + {taskCount} task{taskCount === 1 ? "" : "s"}
            </button>
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              className="w-full rounded-lg px-3 py-1.5 text-[12px] font-semibold text-faint transition-colors hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
