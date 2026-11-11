"use client";

import { useLook } from "@/components/providers/look-provider";
import { LOOKS } from "@/lib/themes";
import { cn } from "@/lib/utils";

/**
 * The looks, as small pictures: a ground, a card on it, a button on the card.
 * A click repaints the app at once and saves the choice to the account; a
 * save that fails puts the old look back.
 */
export function LookPicker({ className }: { className?: string }) {
  const { look, pick } = useLook();

  return (
    <div
      role="radiogroup"
      aria-label="Look"
      className={cn("grid grid-cols-4 gap-2", className)}
    >
      {LOOKS.map((l) => {
        const on = l.id === look;
        return (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => pick(l.id)}
            className="group flex min-w-0 flex-col gap-1 rounded-[9px] outline-none"
          >
            {/* The swatch is the look's own colours whatever look is in front, so they are written here and not read from the theme. */}
            <span
              aria-hidden
              className={cn(
                "relative block h-[46px] w-full overflow-hidden rounded-[7px] outline outline-2 outline-offset-2 transition-[outline-color] group-focus-visible:outline-primary",
                on ? "outline-primary" : "outline-transparent group-hover:outline-faint2",
              )}
              style={{ background: l.ground, boxShadow: "inset 0 0 0 1px var(--border)" }}
            >
              <span
                className="absolute inset-x-[7px] -bottom-1 top-[9px] rounded-[5px]"
                style={{ background: l.card }}
              />
              <span
                className="absolute left-[13px] top-[16px] h-[6px] w-[26px] rounded-[3px]"
                style={{ background: l.button }}
              />
            </span>
            <span
              className={cn(
                "truncate text-center text-[10.5px] font-semibold",
                on ? "text-ink" : "text-muted",
              )}
            >
              {l.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
