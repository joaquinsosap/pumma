"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Check } from "@/components/icons";
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
 * Direction lives INSIDE the choice: picking the sort you already have flips
 * it. A second control (a toggle, a split button) would double the footprint
 * of something used rarely, and every convention it could copy — column
 * headers, terminal `ls -r` — already works this way: you reverse an ordering
 * by asking for it again. The button's icon carries the state: the two-headed
 * arrow means the sort's natural direction, a single arrow means you turned
 * it around.
 *
 * "custom" appears in the menu only where a view has a way to arrange things
 * by hand, and those views also select it FOR you when you drag — picking it
 * from the menu just returns to the arrangement you made last time.
 */
export function SortMenu<T extends string>({
  options,
  value,
  onChange,
  reversed = false,
  onReversedChange,
  className,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  /** Is the current sort running backwards? */
  reversed?: boolean;
  /** Omitted = this menu has no direction (nothing changes for the caller). */
  onReversedChange?: (next: boolean) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const flippable = Boolean(onReversedChange);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Sort: ${SORT_LABELS[value] ?? value}${
            reversed ? ", reversed" : ""
          }`}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface2 px-2.5 py-1.5 text-[12px] font-semibold text-muted transition-colors hover:border-faint hover:text-ink",
            className,
          )}
        >
          {reversed ? (
            <ArrowUp className="h-3.5 w-3.5 text-primary" />
          ) : (
            <ArrowUpDown className="h-3.5 w-3.5" />
          )}
          {SORT_LABELS[value] ?? value}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1.5">
        <p className="px-2 pb-1 pt-0.5 font-mono text-[10px] uppercase tracking-widest text-faint2">
          Sort by
        </p>
        {options.map((option) => {
          const current = option === value;
          return (
            <button
              key={option}
              type="button"
              onClick={() => {
                if (!current) {
                  setOpen(false);
                  onChange(option);
                  return;
                }
                if (flippable) {
                  // Stays open: flipping is something you do to LOOK at the
                  // result, and the very next click is often flipping back.
                  onReversedChange?.(!reversed);
                } else {
                  setOpen(false);
                }
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-hover",
                current ? "font-semibold text-ink" : "text-muted",
              )}
            >
              {SORT_LABELS[option] ?? option}
              {current &&
                (flippable ? (
                  reversed ? (
                    <ArrowUp className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <ArrowDown className="h-3.5 w-3.5" />
                  )
                ) : (
                  <Check className="h-3.5 w-3.5" />
                ))}
            </button>
          );
        })}
        {flippable && (
          <p className="px-2 pb-0.5 pt-1 font-mono text-[9.5px] text-faint2">
            Pick again to reverse
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
