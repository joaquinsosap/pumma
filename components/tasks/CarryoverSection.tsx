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
        "border border-dashed border-tasks/35 bg-tasks/[0.07] p-[9px_11px]",
        variant === "page" && "rounded-[13px] p-3",
        // Hung off the panel's titlebar rather than floating under it.
        //
        // Carryover is not a card that happens to sit near the top of the
        // list; it is the red bar's own overflow, yesterday's tasks still
        // attached to today. Drawn as a rounded box with air above it, it
        // read as the first item in the list, which is exactly what it is
        // not.
        //
        // So it meets the bar's underside with no gap and no top edge of its
        // own, and keeps its sides straight all the way down. Only the
        // bottom corners round off.
        //
        // Narrower than the bar, though, and narrower than the list below
        // it. That inset is the whole illusion: the bar runs edge to edge
        // and the tab hangs inside it, which is the relationship the
        // iPhone's island has with the top of the screen. Matched to the
        // bar's width it stopped being a thing hanging off an edge and went
        // back to being the top of the panel.
        //
        // Collapsed it is a tab; expanded it is the same shape, further
        // down.
        variant === "agenda" && "mx-3 -mt-3 rounded-b-[14px] border-t-0",
        className,
      )}
      style={
        variant === "page" && !flat
          ? { boxShadow: "2px 2px 0 var(--shadow)" }
          : undefined
      }
    >
      {collapsible ? (
        <div className="flex w-full items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1 text-left transition-colors hover:text-tasks",
              headerClass,
            )}
            aria-expanded={open}
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-tasks/70 transition-transform duration-200",
                !open && "-rotate-90",
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
          className={cn(
            headerClass,
            "mb-1.5 block transition-colors hover:text-tasks",
          )}
        >
          {headerLabel}
        </Link>
      ) : (
        <p className={cn(headerClass, "m-0 mb-1.5")}>{headerLabel}</p>
      )}

      {variant === "agenda" ? (
        <div
          className={cn(
            "grid transition-[grid-template-rows] duration-300 ease-out",
            open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="overflow-hidden">{agendaList}</div>
        </div>
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
