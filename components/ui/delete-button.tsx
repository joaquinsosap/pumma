"use client";

import { Trash2 } from "@/components/icons";
import { cn } from "@/lib/utils";

type Size = "sm" | "md";

const BOX: Record<Size, string> = {
  sm: "h-6 w-6",
  md: "h-7 w-7 max-lg:h-8 max-lg:w-8",
};

const ICON: Record<Size, string> = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
};

/**
 * The one control that deletes something.
 *
 * Always a trash bin, never an ✕ — an ✕ in a corner means "close this", and a
 * control that destroys data should not be one glance away from one that
 * doesn't. It also sits in the destructive red at rest rather than going grey
 * and only turning red under the cursor, so the danger is visible before you
 * reach for it. Hover and keyboard focus deepen the red and fill the
 * background, which is the moment you're about to commit.
 *
 * `revealOnHover` keeps a row uncluttered on the desktop, where the pointer
 * says which row you mean. On phones it stays visible: there is no hover, so
 * hiding it there would hide it for good.
 */
export function DeleteButton({
  onClick,
  label,
  size = "sm",
  revealOnHover,
  disabled,
  className,
}: {
  onClick: () => void;
  /** Names the thing being deleted, e.g. "Delete task Pay rent". */
  label: string;
  size?: Size;
  revealOnHover?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        // These often sit inside a link or a clickable row.
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md text-tasks/65 transition-colors",
        "hover:bg-tasks/15 hover:text-tasks",
        "focus-visible:bg-tasks/15 focus-visible:text-tasks focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tasks/40",
        "disabled:pointer-events-none disabled:opacity-40",
        BOX[size],
        revealOnHover &&
          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-lg:opacity-100",
        className
      )}
    >
      <Trash2 className={ICON[size]} />
    </button>
  );
}
