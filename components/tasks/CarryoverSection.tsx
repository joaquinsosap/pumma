"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "@/components/icons";
import type { Task, Tag } from "@/lib/schemas";
import { Taggable } from "@/components/tags/TagMenuProvider";
import { TaskList } from "@/components/tasks/TaskList";
import { PriorityChip } from "@/components/tasks/PriorityChip";
import type { SelectionController } from "@/lib/use-task-selection";
import { cn } from "@/lib/utils";

type Props = {
  tasks: Task[];
  variant?: "agenda" | "page";
  tags?: Tag[];
  href?: string;
  taskHref?: (task: Task) => string;
  className?: string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  flat?: boolean;
  defaultOpen?: boolean;
  selection?: SelectionController;
};

export function CarryoverSection({
  tasks,
  variant = "page",
  tags = [],
  href,
  taskHref,
  className,
  selectedId,
  onSelect,
  flat = false,
  defaultOpen = true,
  selection,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const collapsible = variant === "agenda";

  if (!tasks.length) return null;

  const headerClass =
    "font-mono text-[10px] font-semibold tracking-wide text-tasks/80";

  const headerLabel = `↩ CARRYOVER · ${tasks.length} UNFINISHED`;

  const agendaList = (
    <div className="mt-1.5 flex flex-col gap-1">
      {tasks.map((t) => {
        const content = (
          <>
            <span className="h-[15px] w-[15px] shrink-0 rounded border-[1.6px] border-tasks/55" />
            <PriorityChip priority={t.priority} />
            <span className="min-w-0 truncate">{t.title}</span>
          </>
        );
        return (
          <Taggable
            key={t.id}
            entity="task"
            id={t.id}
            tagIds={t.tagIds}
            lifeArea={t.lifeArea}
            className="flex items-center gap-2 text-[12.5px]"
          >
            {taskHref ? (
              <Link
                href={taskHref(t)}
                className="flex min-w-0 flex-1 items-center gap-2 transition-colors hover:text-tasks"
              >
                {content}
              </Link>
            ) : (
              content
            )}
          </Taggable>
        );
      })}
    </div>
  );

  return (
    <section
      className={cn(
        "rounded-[13px] border border-dashed border-tasks/35 bg-tasks/[0.07] p-[9px_11px]",
        variant === "page" && "p-3",
        className
      )}
      style={
        variant === "page" && !flat ? { boxShadow: "2px 2px 0 var(--shadow)" } : undefined
      }
    >
      {collapsible ? (
        <div className="flex w-full items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 text-left transition-colors hover:text-tasks",
              headerClass
            )}
            aria-expanded={open}
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-tasks/70 transition-transform duration-200",
                !open && "-rotate-90"
              )}
            />
            <span className="min-w-0 truncate">{headerLabel}</span>
          </button>
          {href ? (
            <Link
              href={href}
              className="shrink-0 font-mono text-[9px] text-faint transition-colors hover:text-tasks"
            >
              all →
            </Link>
          ) : null}
        </div>
      ) : href ? (
        <Link
          href={href}
          className={cn(headerClass, "mb-1.5 block transition-colors hover:text-tasks")}
        >
          {headerLabel}
        </Link>
      ) : (
        <p className={cn(headerClass, "m-0 mb-1.5")}>{headerLabel}</p>
      )}

      {variant === "agenda" ? (
        open ? agendaList : null
      ) : (
        <div className="mt-2 overflow-hidden rounded-lg border border-tasks/20 bg-surface">
          <TaskList
            tasks={tasks}
            tags={tags}
            showDelete
            dueField="full"
            variant="page"
            selectedId={selectedId}
            onSelect={onSelect}
            selection={selection}
          />
        </div>
      )}
    </section>
  );
}
