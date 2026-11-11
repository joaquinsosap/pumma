"use client";

import { JiraMark, Link2 } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * The door to bringing tickets in, beside the page's New button: Jira's own
 * mark, with a small link on its corner to say it is a connection and not a
 * page of Jira. Drawn only where a Jira is connected.
 */
export function JiraImportButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Bring in from Jira"
      title="Bring in from Jira"
      className={cn(
        "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface transition-colors hover:border-faint2",
        className,
      )}
    >
      {/* The blue is on the mark itself: the theme sets a button's own text colour. */}
      <JiraMark className="h-3.5 w-3.5 text-jira" />
      <span
        aria-hidden
        className="absolute -bottom-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-surface text-muted"
      >
        <Link2 className="h-2.5 w-2.5" strokeWidth={2.6} />
      </span>
    </button>
  );
}
