import type { SVGProps } from "react";

/**
 * The drawn glyph set.
 *
 * Flat filled pictograms: one path, one colour, no overlay. They take their
 * colour from `currentColor`, so every `text-tasks` / `text-habits` class at
 * the call sites keeps working and an icon is a `d` string and nothing else.
 *
 * These used to carry a gloss gradient over the fill. It was subtle on a
 * chevron and disastrous on anything round — a vertical gradient across a
 * filled circle reads as a sphere, so the Habits tick looked moulded rather
 * than drawn. Depth in this theme belongs to surfaces; an icon is a shape.
 *
 * Knockouts (the tick inside a circle, a calendar's day cells) are subpaths
 * relying on `evenodd`, so every icon sets it.
 */

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** Accepted and ignored — lucide's API, so call sites need no edits. */
  strokeWidth?: number | string;
  size?: number | string;
};

function Glyph({
  d,
  strokeWidth: _sw,
  size: _size,
  ...rest
}: IconProps & { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false" {...rest}>
      <path d={d} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

const HOME =
  "M12 2.3 1.7 11.9h3.05v9.85h14.5V11.9h3.05Z" + "M10.15 21.75v-5.6h3.7v5.6Z";

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
  "M3.4 3.95h5.7l2 2.2h9.5a1 1 0 0 1 1 1v11.9a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1V4.95a1 1 0 0 1 1-1Z" +
  "M6.8 10.35v6.4h3.4v-6.4Z" +
  "M12.9 10.35v4.2h3.4v-4.2Z";

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
  "M11.5 2.5 13.4 7.7l5.2 1.9-5.2 1.9-1.9 5.2-1.9-5.2L4.4 9.6l5.2-1.9Z" +
  "M18.7 15.1l.85 2.35 2.35.85-2.35.85-.85 2.35-.85-2.35-2.35-.85 2.35-.85Z" +
  "M4.7 16.3l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7Z";

export const HomeGlyph = (p: IconProps) => <Glyph d={HOME} {...p} />;
export const TasksGlyph = (p: IconProps) => <Glyph d={TASKS} {...p} />;
export const NotesGlyph = (p: IconProps) => <Glyph d={NOTES} {...p} />;
export const HabitsGlyph = (p: IconProps) => <Glyph d={HABITS} {...p} />;
export const GoalsGlyph = (p: IconProps) => <Glyph d={GOALS} {...p} />;
export const ProjectsGlyph = (p: IconProps) => <Glyph d={PROJECTS} {...p} />;
export const CalendarGlyph = (p: IconProps) => <Glyph d={CALENDAR} {...p} />;
export const LifeCalendarGlyph = (p: IconProps) => <Glyph d={LIFE} {...p} />;
export const AssistantGlyph = (p: IconProps) => <Glyph d={ASSISTANT} {...p} />;

/* ── Chrome ──────────────────────────────────────────────────────────────
   The arrows, ticks and tools. These sit at 12–14px where a filled glyph has
   to stay blunt to survive, so they are chunkier than the nav set and carry
   less internal detail. */

const CHEVRON_LEFT = "M16.1 4.4 7.9 12l8.2 7.6v-2.7L12.1 12l4-4.9Z";

const CHEVRON_RIGHT = "M7.9 4.4 16.1 12l-8.2 7.6v-2.7L11.9 12l-4-4.9Z";

const CHEVRON_DOWN = "M4.4 7.9 12 16.1l7.6-8.2h-2.7L12 11.9 7.1 7.9Z";

const ARROW_LEFT = "M3.3 12 11.1 4.9v4.4h9.6v5.4h-9.6v4.4Z";

/* The Return key's own arrow: down the right-hand stem, then left into the
   head. This replaces a bare "↵" in the capture bar and the tutorial, where
   the glyph was whatever the fallback font happened to draw. */
const ENTER = "M20.7 4.95v10.8H8.9v3.3L3.3 14l5.6-5v3.3h8.4V4.95Z";

const CHECK =
  "M21 4.55a1.9 1.9 0 0 1 .2 2.7L11 19.35a1.9 1.9 0 0 1-2.8.1L3 14.25a1.9 1.9 0 1 1 2.7-2.7l3.7 3.7 8.9-10.5a1.9 1.9 0 0 1 2.7-.2Z";

const PLUS =
  "M12 2.6a1.9 1.9 0 0 1 1.9 1.9v5.6h5.6a1.9 1.9 0 0 1 0 3.8h-5.6v5.6a1.9 1.9 0 0 1-3.8 0v-5.6H4.5a1.9 1.9 0 0 1 0-3.8h5.6V4.5A1.9 1.9 0 0 1 12 2.6Z";

const CLOSE =
  "M4.5 4.5a1.8 1.8 0 0 1 2.6 0L12 9.4l4.9-4.9a1.8 1.8 0 1 1 2.6 2.6L14.6 12l4.9 4.9a1.8 1.8 0 1 1-2.6 2.6L12 14.6l-4.9 4.9a1.8 1.8 0 0 1-2.6-2.6L9.4 12 4.5 7.1a1.8 1.8 0 0 1 0-2.6Z";

const SEARCH =
  "M9.9 2.2a8.2 8.2 0 1 0 4.9 14.8l4.4 4.4a1.8 1.8 0 0 0 2.6-2.6l-4.4-4.4A8.2 8.2 0 0 0 9.9 2.2Zm0 3.4a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6Z";

const TRASH =
  "M9.4 1.8h5.2a1.4 1.4 0 0 1 1.4 1.4v1.2h4.6a1.3 1.3 0 0 1 0 2.6H3.4a1.3 1.3 0 0 1 0-2.6H8V3.2a1.4 1.4 0 0 1 1.4-1.4Zm1.2 2.6h2.8v-.6h-2.8Z" +
  "M5.6 8.4h12.8l-.9 12.1a1.5 1.5 0 0 1-1.5 1.4H8a1.5 1.5 0 0 1-1.5-1.4Zm3.3 2.4v8.4h1.9v-8.4Zm4.3 0v8.4h1.9v-8.4Z";

const PENCIL =
  "M17.1 1.9a1.6 1.6 0 0 1 2.3 0l2.7 2.7a1.6 1.6 0 0 1 0 2.3l-1.9 1.9-5-5Z" +
  "M14.1 4.9l5 5L9 20a1.6 1.6 0 0 1-.7.4l-5.2 1.5a.9.9 0 0 1-1.1-1.1l1.5-5.2a1.6 1.6 0 0 1 .4-.7Z";

const PLAY =
  "M6.7 3.5a1.5 1.5 0 0 1 1.55.06l10.2 7a1.5 1.5 0 0 1 0 2.48l-10.2 7A1.5 1.5 0 0 1 5.9 20.8V4.8a1.5 1.5 0 0 1 .8-1.3Z";

export const ChevronLeftGlyph = (p: IconProps) => (
  <Glyph d={CHEVRON_LEFT} {...p} />
);
export const ChevronRightGlyph = (p: IconProps) => (
  <Glyph d={CHEVRON_RIGHT} {...p} />
);
export const ChevronDownGlyph = (p: IconProps) => (
  <Glyph d={CHEVRON_DOWN} {...p} />
);
export const ArrowLeftGlyph = (p: IconProps) => <Glyph d={ARROW_LEFT} {...p} />;
export const EnterGlyph = (p: IconProps) => <Glyph d={ENTER} {...p} />;
export const CheckGlyph = (p: IconProps) => <Glyph d={CHECK} {...p} />;
export const PlusGlyph = (p: IconProps) => <Glyph d={PLUS} {...p} />;
export const CloseGlyph = (p: IconProps) => <Glyph d={CLOSE} {...p} />;
export const SearchGlyph = (p: IconProps) => <Glyph d={SEARCH} {...p} />;
export const TrashGlyph = (p: IconProps) => <Glyph d={TRASH} {...p} />;
export const PencilGlyph = (p: IconProps) => <Glyph d={PENCIL} {...p} />;
export const PlayGlyph = (p: IconProps) => <Glyph d={PLAY} {...p} />;
