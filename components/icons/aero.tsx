import type { SVGProps } from "react";

/**
 * Aero pictograms.
 *
 * Lucide draws line art. Aero's icons are the opposite — filled, glossy,
 * lit from above — and no amount of filtering turns a stroke outline into
 * one, which is why these are drawn rather than styled.
 *
 * Each icon is one path, painted twice: once in `currentColor`, then again
 * in a gloss gradient with a hard midline. That keeps every `text-tasks` /
 * `text-habits` class at the call sites working exactly as before — the
 * icon takes the app's semantic colour and the finish rides on top of it —
 * and it means an icon is a `d` string plus nothing else.
 *
 * Knockouts (the tick inside a circle, a calendar's day cells) are subpaths
 * relying on `evenodd`, so every icon sets it.
 *
 * The gradient id repeats once per rendered icon. That is deliberate: a
 * shared `<defs>` mounted somewhere else would make these silently render as
 * nothing wherever it wasn't. Duplicate ids all resolve to the first, and
 * every definition here is identical, so the result is the same either way.
 */

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** Accepted and ignored — lucide's API, so call sites need no edits. */
  strokeWidth?: number | string;
  size?: number | string;
};

function Aero({
  d,
  strokeWidth: _sw,
  size: _size,
  ...rest
}: IconProps & { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false" {...rest}>
      <defs>
        {/* A whisper, not a shine. The hard midline is gone — that split was
            the single most 2006 thing about these, and at 16px it read as a
            highlight stuck to the glyph rather than light falling on it. */}
        <linearGradient id="aeroGloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.26" />
          <stop offset="55%" stopColor="#fff" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.07" />
        </linearGradient>
      </defs>
      <path d={d} fill="currentColor" fillRule="evenodd" />
      <path d={d} fill="url(#aeroGloss)" fillRule="evenodd" />
    </svg>
  );
}

const HOME =
  "M12 2.2 2 11h20ZM4.6 12.4h14.8v8.6a.9.9 0 0 1-.9.9h-3.9v-5.7h-4.4v5.7H5.5a.9.9 0 0 1-.9-.9Z";

const TASKS =
  "M3.4 4.6h3.5a1 1 0 0 1 1 1V9a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V5.6a1 1 0 0 1 1-1Z" +
  "M3.4 14h3.5a1 1 0 0 1 1 1v3.4a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V15a1 1 0 0 1 1-1Z" +
  "M10.6 6.1h10.2a1.15 1.15 0 0 1 0 2.3H10.6a1.15 1.15 0 0 1 0-2.3Z" +
  "M10.6 15.5h10.2a1.15 1.15 0 0 1 0 2.3H10.6a1.15 1.15 0 0 1 0-2.3Z";

const NOTES =
  "M5.6 2.4h12.8a1 1 0 0 1 1 1v17.2a1 1 0 0 1-1 1H5.6a1 1 0 0 1-1-1V3.4a1 1 0 0 1 1-1Z" +
  "M7.6 6.8v1.9h8.8V6.8Z" +
  "M7.6 11v1.9h8.8V11Z" +
  "M7.6 15.2v1.9h5.6v-1.9Z";

const HABITS =
  "M12 2.2a9.8 9.8 0 1 0 0 19.6 9.8 9.8 0 0 0 0-19.6Z" +
  "M16.5 8.5 10.4 16a1 1 0 0 1-1.5.06L5.9 13.1l1.6-1.6 2.3 2.3 5.2-6.2Z";

const GOALS =
  "M12 2.2a9.8 9.8 0 1 0 0 19.6 9.8 9.8 0 0 0 0-19.6Z" +
  "M12 4.9a7.1 7.1 0 1 1 0 14.2 7.1 7.1 0 0 1 0-14.2Z" +
  "M12 7.6a4.4 4.4 0 1 0 0 8.8 4.4 4.4 0 0 0 0-8.8Z" +
  "M12 10.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z";

const PROJECTS =
  "M3.4 4.4h5.7l2 2.2h9.5a1 1 0 0 1 1 1v11.9a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V5.4a1 1 0 0 1 1-1Z" +
  "M6.8 10.8v6.4h3.4v-6.4Z" +
  "M12.9 10.8V15h3.4v-4.2Z";

const CALENDAR =
  "M6.3 1.8a1.15 1.15 0 0 1 1.15 1.15V4h9.1V2.95a1.15 1.15 0 0 1 2.3 0V4h1.25a1 1 0 0 1 1 1v15.9a1 1 0 0 1-1 1H3.9a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h1.25V2.95A1.15 1.15 0 0 1 6.3 1.8Z" +
  "M5.1 10.2v2.4h3v-2.4Z" +
  "M10.5 10.2v2.4h3v-2.4Z" +
  "M15.9 10.2v2.4h3v-2.4Z" +
  "M5.1 15v2.4h3V15Z" +
  "M10.5 15v2.4h3V15Z" +
  "M15.9 15v2.4h3V15Z";

const LIFE =
  "M6 2.2h12a1.1 1.1 0 0 1 0 2.2h-.6v1.9c0 2.1-1.1 4-2.9 5.1l-1.3.8 1.3.8c1.8 1.1 2.9 3 2.9 5.1v1.9h.6a1.1 1.1 0 0 1 0 2.2H6a1.1 1.1 0 0 1 0-2.2h.6v-1.9c0-2.1 1.1-4 2.9-5.1l1.3-.8-1.3-.8C7.7 10.3 6.6 8.4 6.6 6.3V4.4H6a1.1 1.1 0 0 1 0-2.2Z";

const ASSISTANT =
  "M12 1.8 13.9 7l5.2 1.9-5.2 1.9L12 16l-1.9-5.2L4.9 8.9 10.1 7Z" +
  "M19.2 14.4l.85 2.35 2.35.85-2.35.85-.85 2.35-.85-2.35-2.35-.85 2.35-.85Z" +
  "M5.2 15.6l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7Z";

export const AeroHome = (p: IconProps) => <Aero d={HOME} {...p} />;
export const AeroTasks = (p: IconProps) => <Aero d={TASKS} {...p} />;
export const AeroNotes = (p: IconProps) => <Aero d={NOTES} {...p} />;
export const AeroHabits = (p: IconProps) => <Aero d={HABITS} {...p} />;
export const AeroGoals = (p: IconProps) => <Aero d={GOALS} {...p} />;
export const AeroProjects = (p: IconProps) => <Aero d={PROJECTS} {...p} />;
export const AeroCalendar = (p: IconProps) => <Aero d={CALENDAR} {...p} />;
export const AeroLifeCalendar = (p: IconProps) => <Aero d={LIFE} {...p} />;
export const AeroAssistant = (p: IconProps) => <Aero d={ASSISTANT} {...p} />;

/* ── Chrome ──────────────────────────────────────────────────────────────
   The arrows, ticks and tools. These sit at 12–14px where a filled glyph has
   to stay blunt to survive, so they are chunkier than the nav set and carry
   less internal detail. */

const CHEVRON_LEFT =
  "M15.4 3.6a1.9 1.9 0 0 1 0 2.7L9.7 12l5.7 5.7a1.9 1.9 0 0 1-2.7 2.7l-7-7a1.9 1.9 0 0 1 0-2.7l7-7a1.9 1.9 0 0 1 2.7 0Z";

const CHEVRON_RIGHT =
  "M8.6 3.6a1.9 1.9 0 0 0 0 2.7l5.7 5.7-5.7 5.7a1.9 1.9 0 0 0 2.7 2.7l7-7a1.9 1.9 0 0 0 0-2.7l-7-7a1.9 1.9 0 0 0-2.7 0Z";

const CHEVRON_DOWN =
  "M3.6 8.6a1.9 1.9 0 0 1 2.7 0l5.7 5.7 5.7-5.7a1.9 1.9 0 0 1 2.7 2.7l-7 7a1.9 1.9 0 0 1-2.7 0l-7-7a1.9 1.9 0 0 1 0-2.7Z";

const ARROW_LEFT =
  "M10.5 3.7a1.8 1.8 0 0 1 0 2.6L6.6 10.2h13.6a1.8 1.8 0 0 1 0 3.6H6.6l3.9 3.9a1.8 1.8 0 0 1-2.6 2.6l-7-7a1.8 1.8 0 0 1 0-2.6l7-7a1.8 1.8 0 0 1 2.6 0Z";

/* The Return key's own arrow: down the right-hand stem, then left into the
   head. This replaces a bare "↵" in the capture bar and the tutorial, where
   the glyph was whatever the fallback font happened to draw. */
const ENTER =
  "M20.4 3.4a1.7 1.7 0 0 1 1.7 1.7v7.6a1.7 1.7 0 0 1-1.7 1.7H7.9v3.1a1.1 1.1 0 0 1-1.8.85l-5.1-4.2a1.1 1.1 0 0 1 0-1.7l5.1-4.2a1.1 1.1 0 0 1 1.8.85v3.1h10.8V5.1a1.7 1.7 0 0 1 1.7-1.7Z";

const CHECK =
  "M21 5.1a1.9 1.9 0 0 1 .2 2.7L11 19.9a1.9 1.9 0 0 1-2.8.1L3 14.8a1.9 1.9 0 1 1 2.7-2.7l3.7 3.7 8.9-10.5a1.9 1.9 0 0 1 2.7-.2Z";

const PLUS =
  "M12 2.6a1.9 1.9 0 0 1 1.9 1.9v5.6h5.6a1.9 1.9 0 0 1 0 3.8h-5.6v5.6a1.9 1.9 0 0 1-3.8 0v-5.6H4.5a1.9 1.9 0 0 1 0-3.8h5.6V4.5A1.9 1.9 0 0 1 12 2.6Z";

const CLOSE =
  "M4.5 4.5a1.8 1.8 0 0 1 2.6 0L12 9.4l4.9-4.9a1.8 1.8 0 1 1 2.6 2.6L14.6 12l4.9 4.9a1.8 1.8 0 1 1-2.6 2.6L12 14.6l-4.9 4.9a1.8 1.8 0 0 1-2.6-2.6L9.4 12 4.5 7.1a1.8 1.8 0 0 1 0-2.6Z";

const SEARCH =
  "M10.4 2.2a8.2 8.2 0 1 0 4.9 14.8l4.4 4.4a1.8 1.8 0 0 0 2.6-2.6l-4.4-4.4A8.2 8.2 0 0 0 10.4 2.2Zm0 3.4a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Z";

const TRASH =
  "M9.4 1.8h5.2a1.4 1.4 0 0 1 1.4 1.4v1.2h4.6a1.3 1.3 0 0 1 0 2.6H3.4a1.3 1.3 0 0 1 0-2.6H8V3.2a1.4 1.4 0 0 1 1.4-1.4Zm1.2 2.6h2.8v-.6h-2.8Z" +
  "M5.6 8.4h12.8l-.9 12.1a1.5 1.5 0 0 1-1.5 1.4H8a1.5 1.5 0 0 1-1.5-1.4Zm3.3 2.4v8.4h1.9v-8.4Zm4.3 0v8.4h1.9v-8.4Z";

const PENCIL =
  "M17.1 1.9a1.6 1.6 0 0 1 2.3 0l2.7 2.7a1.6 1.6 0 0 1 0 2.3l-1.9 1.9-5-5Z" +
  "M14.1 4.9l5 5L9 20a1.6 1.6 0 0 1-.7.4l-5.2 1.5a.9.9 0 0 1-1.1-1.1l1.5-5.2a1.6 1.6 0 0 1 .4-.7Z";

const PLAY =
  "M7.6 3.5a1.5 1.5 0 0 1 1.55.06l10.2 7a1.5 1.5 0 0 1 0 2.48l-10.2 7A1.5 1.5 0 0 1 6.8 20.8V4.8a1.5 1.5 0 0 1 .8-1.3Z";

export const AeroChevronLeft = (p: IconProps) => (
  <Aero d={CHEVRON_LEFT} {...p} />
);
export const AeroChevronRight = (p: IconProps) => (
  <Aero d={CHEVRON_RIGHT} {...p} />
);
export const AeroChevronDown = (p: IconProps) => (
  <Aero d={CHEVRON_DOWN} {...p} />
);
export const AeroArrowLeft = (p: IconProps) => <Aero d={ARROW_LEFT} {...p} />;
export const AeroEnter = (p: IconProps) => <Aero d={ENTER} {...p} />;
export const AeroCheck = (p: IconProps) => <Aero d={CHECK} {...p} />;
export const AeroPlus = (p: IconProps) => <Aero d={PLUS} {...p} />;
export const AeroClose = (p: IconProps) => <Aero d={CLOSE} {...p} />;
export const AeroSearch = (p: IconProps) => <Aero d={SEARCH} {...p} />;
export const AeroTrash = (p: IconProps) => <Aero d={TRASH} {...p} />;
export const AeroPencil = (p: IconProps) => <Aero d={PENCIL} {...p} />;
export const AeroPlay = (p: IconProps) => <Aero d={PLAY} {...p} />;
