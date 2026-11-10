"use client";

import { Link2 } from "@/components/icons";
import { ticketFromUrl } from "@/lib/ticket-link";
import { cn } from "@/lib/utils";

/**
 * A task's ticket, as a chip that opens it: "VST-1234" for a Jira link, the
 * site's name for any other.
 *
 * Draws nothing for a task with no link, and nothing for a stored value that
 * is not a safe address, so a caller never has to check before using it.
 *
 * `nested` is for rows that are already one big link. A link inside a link is
 * not valid, so there the chip is a span that opens the ticket itself.
 */
export function TicketChip({
  url,
  nested = false,
  className,
}: {
  url: string | null | undefined;
  nested?: boolean;
  className?: string;
}) {
  const ticket = ticketFromUrl(url);
  if (!ticket) return null;

  // 13px of text plus the border is 15px: inside the tag line's own height, so a row with a ticket is no taller than its neighbours.
  const look = cn(
    // No shrink-0: on a line narrower than the chip, the label gives way with an ellipsis instead of being cut mid-letter.
    "inline-flex min-w-0 items-center gap-1 whitespace-nowrap rounded-[5px] border border-border bg-surface2 px-1.5 font-mono text-[10px] font-semibold leading-[13px] text-ink no-underline transition-colors hover:border-faint2 hover:bg-hover",
    className,
  );
  const inside = (
    <>
      <Link2 aria-hidden className="h-2.5 w-2.5 shrink-0 text-muted" strokeWidth={2.4} />
      <span className="truncate">{ticket.label}</span>
    </>
  );
  const label = `Open ticket ${ticket.label}`;

  if (nested) {
    const open = () => window.open(ticket.url, "_blank", "noopener,noreferrer");
    return (
      <span
        role="link"
        tabIndex={0}
        title={label}
        aria-label={label}
        className={cn(look, "cursor-pointer")}
        onClick={(e) => {
          // The row around it is a link of its own, and must not follow.
          e.preventDefault();
          e.stopPropagation();
          open();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key !== "Enter") return;
          e.preventDefault();
          open();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        {inside}
      </span>
    );
  }

  return (
    <a
      href={ticket.url}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className={look}
      // Opening the ticket is not picking the row, opening the task or lifting
      // the card. The drag sensors listen for mouse, touch and key presses, so
      // each is kept from reaching the card: Enter on the chip follows the link.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {inside}
    </a>
  );
}
