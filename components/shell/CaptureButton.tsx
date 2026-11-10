"use client";

import { Plus } from "@/components/icons";
import { askCapture } from "@/lib/ask-capture";
import { CAPTURE_NAMES } from "@/lib/capture-context";
import type { OmniType } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * "New task", "New note" and their kin.
 *
 * Not a form of its own: it points the capture bar at that kind of thing and
 * puts the caret in it. The bar already catches whatever is typed anywhere on
 * the page, which nobody can know by looking. This is the same door, drawn.
 *
 * `compact` is the plus on its own, for a widget's title bar. `tight` keeps
 * the words until there is no room for them: beside a page title on a screen
 * just wide enough for the bar, a long greeting needs the space more.
 */
export function CaptureButton({
  type,
  compact = false,
  tight = false,
  className,
}: {
  type: OmniType;
  compact?: boolean;
  tight?: boolean;
  className?: string;
}) {
  const label = `New ${CAPTURE_NAMES[type]}`;
  return (
    <button
      type="button"
      onClick={() => askCapture(type)}
      aria-label={label}
      title={compact || tight ? label : undefined}
      className={cn(
        "shrink-0 items-center justify-center border border-border text-muted transition-colors hover:border-faint2 hover:text-ink",
        compact
          ? "flex h-6 w-6 rounded-md"
          : "inline-flex h-7 gap-1 rounded-lg bg-surface px-2.5 text-[12px] font-semibold",
        !compact && tight && "max-xl:w-7 max-xl:px-0",
        className,
      )}
    >
      <Plus
        aria-hidden
        className={compact ? "h-3 w-3" : "h-3.5 w-3.5"}
        strokeWidth={2.5}
      />
      {!compact && (
        <span className={tight ? "max-xl:hidden" : undefined}>{label}</span>
      )}
    </button>
  );
}
