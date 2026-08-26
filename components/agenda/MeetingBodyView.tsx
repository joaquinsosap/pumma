"use client";

import { useState } from "react";
import { ChevronDown, Link2 } from "@/components/icons";
import { parseMeetingBody } from "@/lib/meeting-body";
import { cn } from "@/lib/utils";

/**
 * A meeting's body, for humans.
 *
 * An invite from Teams or Zoom is a generated block: a join link wrapped in
 * tracking, an ID, a passcode, and paragraphs of boilerplate. Rendered raw it
 * was several hundred characters of URL-encoded noise where the one thing
 * anybody wants — the button that joins the call — was buried in the middle
 * of it and cut off by the column.
 *
 * So it is taken apart (lib/meeting-body) and shown as what it is: one
 * button, the couple of values you might have to read aloud, and whatever
 * sentence a person actually wrote. The full original stays available behind
 * a disclosure, because "cleaned up" should never mean "thrown away".
 */

const KIND_TINT: Record<string, string> = {
  teams: "oklch(0.55 0.16 274)",
  zoom: "oklch(0.58 0.14 245)",
  meet: "oklch(0.6 0.13 155)",
  webex: "oklch(0.6 0.11 200)",
};

export function MeetingBodyView({
  notes,
  compact = false,
  showCodes = false,
  className,
}: {
  notes: string;
  /** Row context: the button, nothing else, until it is opened. */
  compact?: boolean;
  /** Meeting ID and passcode. Off unless asked for — see the setting. */
  showCodes?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(false);
  const body = parseMeetingBody(notes ?? "");

  const details = showCodes ? body.details : [];
  const hasMore = Boolean(body.text || details.length || body.invitees.length);
  if (!body.conference && !hasMore) return null;

  const tint = body.conference ? KIND_TINT[body.conference.kind] : undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {body.conference && (
        <a
          href={body.conference.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex w-fit items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90"
          style={{ background: tint }}
        >
          <Link2 className="h-3.5 w-3.5" />
          {body.conference.label}
        </a>
      )}

      {details.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {details.map((d) => (
            <span
              key={d.label}
              className="rounded-md border border-border bg-surface2 px-2 py-1 font-mono text-[11px] text-muted"
            >
              <span className="text-faint2">{d.label} </span>
              {/* Selectable on purpose: a passcode exists to be copied. */}
              <span className="select-text font-semibold text-ink">
                {d.value}
              </span>
            </span>
          ))}
        </div>
      )}

      {body.text && (compact ? open : true) && (
        <p className="m-0 whitespace-pre-line text-[12px] leading-relaxed text-muted">
          {body.text}
        </p>
      )}

      {compact && body.text && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          className="flex w-fit items-center gap-1 font-mono text-[10.5px] text-faint hover:text-ink"
        >
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
          {open ? "Less" : "Details"}
        </button>
      )}

      {/* Nothing is deleted, only folded away. A generated invite sometimes
          carries the one line that matters in a place the cleanup cannot
          know about, and "show me what it actually said" has to be possible. */}
      {!compact && notes.trim() && notes.trim() !== body.text && (
        <div>
          <button
            type="button"
            onClick={() => setRaw((v) => !v)}
            className="font-mono text-[10.5px] text-faint2 underline-offset-2 hover:text-muted hover:underline"
          >
            {raw ? "Hide original" : "Show original invite"}
          </button>
          {raw && (
            <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border2 bg-surface2 p-2 font-mono text-[10.5px] leading-relaxed text-faint">
              {notes}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
