"use client";

import { useId } from "react";
import { Pencil } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * A title you can edit in place, and can tell is editable without touching it.
 *
 * These titles used to be bare inputs styled to look exactly like the heading
 * they sit in: no border, no background, no icon. The only tell was a hover
 * state, which meant the edit was invisible to anyone who had not already
 * happened to sweep the mouse across it — and invisible entirely on touch.
 *
 * So the pencil is always drawn, quietly, and it sits *next to the title*
 * rather than at the far edge of whatever panel this is in: an icon stranded
 * across a header does not read as belonging to the text. Getting it there
 * needs the field to be as wide as its own text, which is what the mirror span
 * below does — it holds the column open at the text's natural width and the
 * input lies on top of it. `max-w-full` keeps a long title from pushing the
 * pencil out of the panel; past that the input scrolls, as inputs do.
 *
 * The input lies on top of the span rather than beside it in the same grid
 * cell: an `<input>` carries an intrinsic width of about twenty characters no
 * matter what you set `width` to, and in normal flow that width wins the
 * column and pushes the pencil a good sixty pixels past the end of a short
 * title. Out of flow it contributes nothing and the span decides.
 *
 * The pencil steps out of the way once the field has focus, where the caret
 * and the field's own border are saying the same thing more loudly.
 *
 * Controlled on purpose: each panel already owns its draft (some of them
 * autosave, some reconcile against the server) and this only replaces how the
 * title looks and announces itself, not who holds it.
 */
export function EditableTitle({
  value,
  onChange,
  onCommit,
  onCancel,
  placeholder,
  maxLength,
  ariaLabel,
  className,
  wrapperClassName,
  iconClassName,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Enter, or leaving the field. */
  onCommit: () => void;
  /** Escape. Omit if the title has nothing to revert to. */
  onCancel?: () => void;
  placeholder?: string;
  maxLength?: number;
  ariaLabel: string;
  /** Type styling — this is a heading, so the caller sets its size and weight. */
  className?: string;
  wrapperClassName?: string;
  iconClassName?: string;
}) {
  const hintId = useId();
  return (
    <div
      className={cn(
        "group/title flex min-w-0 items-center gap-1.5",
        wrapperClassName,
      )}
    >
      <div className="relative -mx-1 min-w-0 max-w-full overflow-hidden">
        <span
          aria-hidden
          // Same padding *and* border as the input below it, or the two
          // pixels the input's transparent border takes come off the end of
          // the title.
          className={cn(
            "invisible block whitespace-pre border border-transparent px-1",
            className,
          )}
        >
          {value || placeholder || " "}
        </span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape" && onCancel) {
              onCancel();
              e.currentTarget.blur();
            }
          }}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-label={ariaLabel}
          aria-describedby={hintId}
          className={cn(
            "absolute inset-0 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1 outline-none",
            "transition-colors placeholder:text-faint2",
            "hover:border-border focus:border-faint focus:bg-background/50",
            className,
          )}
        />
      </div>
      <Pencil
        aria-hidden
        className={cn(
          "h-3.5 w-3.5 shrink-0 text-faint2 transition-[color,opacity]",
          "group-hover/title:text-faint",
          "group-focus-within/title:pointer-events-none group-focus-within/title:opacity-0",
          iconClassName,
        )}
      />
      <span id={hintId} className="sr-only">
        Editable — type to rename, Enter to save
      </span>
    </div>
  );
}
