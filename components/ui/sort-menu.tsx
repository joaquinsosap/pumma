"use client";

import { useState } from "react";
import { ArrowUpDown, Check } from "@/components/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SORT_LABELS } from "@/lib/collection-sort";
import { cn } from "@/lib/utils";

/**
 * The one sort control, everywhere a list can be ordered.
 *
 * A small labelled button rather than a toolbar of options, because sorting is
 * chosen rarely and read never: once the list is in the order you wanted, the
 * control's job is to stay out of the way. The current choice is the button's
 * label, so the state is visible without opening anything.
 *
 * "custom" appears in the menu only where a view has a way to arrange things
 * by hand, and those views also select it FOR you when you drag — picking it
 * from the menu just returns to the arrangement you made last time.
 */
export function SortMenu<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Sort: ${SORT_LABELS[value] ?? value}`}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-[12px] font-semibold text-muted transition-colors hover:border-faint hover:text-ink",
            className,
          )}
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
          {SORT_LABELS[value] ?? value}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1.5">
        <p className="px-2 pb-1 pt-0.5 font-mono text-[10px] uppercase tracking-widest text-faint2">
          Sort by
        </p>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setOpen(false);
              if (option !== value) onChange(option);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-hover",
              option === value ? "font-semibold text-ink" : "text-muted",
            )}
          >
            {SORT_LABELS[option] ?? option}
            {option === value && <Check className="h-3.5 w-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
