"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowUpRight, ChevronRight } from "@/components/icons";
import { TicketFacts } from "@/components/tasks/TicketFacts";
import { updateTaskDetail } from "@/lib/actions/tasks";
import { cleanTicketUrl, ticketFromUrl, ticketKeyFrom } from "@/lib/ticket-link";
import { trySave } from "@/lib/try-save";
import { useSyncedDraft } from "@/lib/use-synced-draft";
import { cn } from "@/lib/utils";

const NOT_A_LINK =
  "That is not a link. Paste the ticket's address, starting with https://, or type its number.";

/**
 * The task's ticket in an outside tracker: a box to paste its link into, and
 * once there is one, a card with the ticket's number, a way to open it, and
 * the rest folded away.
 *
 * Only the link is kept. The number is read back out of it, and where the
 * ticket stands is asked of Jira when the card is unfolded, so nothing here
 * can disagree with what is stored.
 */
export function TicketBlock({
  taskId,
  url: storedUrl,
}: {
  taskId: string;
  url: string | null;
}) {
  const [url, setUrl] = useSyncedDraft(storedUrl, taskId);
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const ticket = ticketFromUrl(url);
  // What was last turned down, so leaving the box does not say it a second time.
  const refused = useRef<string | null>(null);

  const save = (raw: string | null) => {
    const next = raw && raw.trim() ? cleanTicketUrl(raw) : null;
    const number = !next && raw ? ticketKeyFrom(raw) : null;
    if (raw && raw.trim() && !next && !number) {
      if (refused.current !== raw) toast.error(NOT_A_LINK);
      refused.current = raw;
      return;
    }
    refused.current = null;
    if (number) {
      // The link is built on the server, from the Jira address saved in
      // Settings, so there is nothing to show until it answers. If no address
      // is saved the server says where to add one, and the number stays typed.
      startTransition(async () => {
        const res = await trySave(() =>
          updateTaskDetail({ id: taskId, ticketUrl: number }),
        );
        if (!res?.ok) return;
        setUrl(res.data?.ticketUrl ?? null);
        setEditing(false);
        setText("");
      });
      return;
    }
    const before = url;
    setEditing(false);
    setText("");
    if (next === before) return;
    // Shown at once; put back if the save does not land.
    setUrl(next);
    startTransition(async () => {
      await trySave(
        () => updateTaskDetail({ id: taskId, ticketUrl: next }),
        () => setUrl(before),
      );
    });
  };

  return (
    <section className="mb-5">
      <h4 className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
        Ticket
      </h4>

      {!ticket || editing ? (
        <input
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          autoFocus={editing}
          value={text}
          onChange={(e) => {
            refused.current = null;
            setText(e.target.value);
          }}
          // A pasted link is the whole answer, so it saves without a second step.
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (!cleanTicketUrl(pasted)) return;
            e.preventDefault();
            save(pasted);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save(text);
            }
            if (e.key === "Escape" && editing) {
              e.stopPropagation();
              setEditing(false);
              setText("");
            }
          }}
          onBlur={() => {
            if (text.trim()) save(text);
            else setEditing(false);
          }}
          placeholder="Paste a ticket link, or type its number"
          aria-label="Ticket link"
          className="w-full rounded-lg border border-border bg-surface2/50 px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-faint2 focus:border-faint"
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface2/50">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="min-w-0 truncate font-mono text-[13px] font-semibold text-ink">
              {ticket.label}
            </span>
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-widest text-faint">
              {ticket.kind === "jira" ? "Jira" : "Link"}
            </span>
            <a
              href={ticket.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-semibold text-ink no-underline transition-colors hover:border-faint"
            >
              Open
              <ArrowUpRight aria-hidden className="h-3 w-3" strokeWidth={2.4} />
            </a>
          </div>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
            className="flex w-full items-center gap-1.5 border-t border-border2 px-3 py-2 text-left text-[11px] font-semibold text-muted transition-colors hover:text-ink"
          >
            <ChevronRight
              aria-hidden
              className={cn(
                "h-3 w-3 transition-transform duration-200",
                open && "rotate-90",
              )}
            />
            Details
          </button>
          {open && (
            <div className="animate-pumma-fade border-t border-border2 px-3 py-2.5">
              {/* Asked of Jira only once the card is unfolded: opening a task is not asking about its ticket. */}
              {ticket.kind === "jira" && (
                <TicketFacts key={ticket.url} url={ticket.url} />
              )}
              <div className="mb-1 font-mono text-[9px] uppercase tracking-widest text-faint2">
                Address
              </div>
              <div
                className="mb-3 break-all font-mono text-[11px] leading-snug text-muted"
                title={ticket.url}
              >
                {ticket.url}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setText(ticket.url);
                    setEditing(true);
                  }}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-semibold text-muted transition-colors hover:border-faint hover:text-ink"
                >
                  Change link
                </button>
                <button
                  type="button"
                  onClick={() => save(null)}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-semibold text-muted transition-colors hover:border-faint hover:text-ink"
                >
                  Remove link
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
