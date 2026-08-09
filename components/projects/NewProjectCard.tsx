"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "@/components/icons";
import { createProjectAction } from "@/lib/actions/projects";
import type { LifeArea } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Props = {
  lifeArea: LifeArea;
  onCreated: (projectId: string) => void;
  className?: string;
};

export function NewProjectCard({ lifeArea, onCreated, className }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await createProjectAction({ title: trimmed, lifeArea });
      if (!res.ok) {
        toast.error(res.error ?? "Could not create project");
        return;
      }
      if (!res.data) {
        toast.error("Could not create project");
        return;
      }
      const { project, adopted } = res.data;
      // Say when the project took over an existing tag — it moves tasks, and
      // silently reassigning someone's work is not a nice surprise.
      toast.success(
        adopted
          ? `Created "${project.title}", #${adopted.tagName} files here now` +
              (adopted.filed
                ? `, ${adopted.filed} unfiled task${adopted.filed === 1 ? "" : "s"} moved in`
                : "")
          : `Created "${project.title}"`,
      );
      setTitle("");
      setOpen(false);
      onCreated(project.id);
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex min-h-[88px] min-w-[160px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[11px] border border-dashed border-border bg-surface/50 p-[11px_14px] text-faint transition-colors hover:border-faint2 hover:bg-surface hover:text-muted",
          className,
        )}
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
        <span className="text-[12px] font-semibold">New project</span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex min-w-[200px] flex-col gap-2 rounded-[11px] border border-border bg-surface p-[11px_14px]",
        className,
      )}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            setOpen(false);
            setTitle("");
          }
        }}
        placeholder="Project name"
        maxLength={120}
        disabled={pending}
        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] font-semibold text-ink outline-none placeholder:text-faint focus:border-faint"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !title.trim()}
          className="flex-1 rounded-lg bg-ink px-2 py-1 text-[11px] font-bold text-background disabled:opacity-50"
        >
          Create
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTitle("");
          }}
          disabled={pending}
          className="rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted hover:bg-hover"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
