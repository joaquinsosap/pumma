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

/**
 * The nine that name a place or a kind of thing are tiles: a rounded square
 * in the entity's own colour with one white mark in the middle. Identical
 * outer geometry means none of them can weigh more than another, which is
 * what kept going wrong when each was a free-standing silhouette.
 *
 * A tile is a noun. Everything under "Chrome" below is a verb, and those
 * stay as bare marks — a tile on a "next page" arrow would be nonsense.
 *
 * Marks are drawn directly at tile scale, roughly x/y 6.4–17.6, so nothing
 * is scaled at render and the centring is the geometry rather than a
 * transform.
 */
function Tile({
  mark,
  strokeWidth: _sw,
  size: _size,
  ...rest
}: IconProps & { mark: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false" {...rest}>
      <rect x="1" y="1" width="22" height="22" rx="6.4" fill="currentColor" />
      <path d={mark} fill="#fff" fillRule="evenodd" />
    </svg>
  );
}

const M_HOME = "M12 6.6 6.4 11.7h1.7v5.7h7.8v-5.7h1.7Z";
const M_TASKS =
  "M6.6 8.7h2.2v2.2H6.6Z" +
  "M10.4 8.9h7v1.8h-7Z" +
  "M6.6 13.1h2.2v2.2H6.6Z" +
  "M10.4 13.3h7v1.8h-7Z";
const M_NOTES = "M7 7h10v2H7Z" + "M7 11h10v2H7Z" + "M7 15h6.4v2H7Z";
const M_HABITS = "M17.6 7.85 10.4 16.15 6.4 12.45l1.7-1.8 2.2 2 5.6-6.4Z";
const M_GOALS =
  "M12 6.2a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6Zm0 2.4a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Z" +
  "M12 10.3a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4Z";
const M_PROJECTS = "M6.4 7.6h3.6l1.3 1.5h6.3v7.3H6.4Z";
const M_CALENDAR =
  "M6.6 8.4h2.6v2.6H6.6Z" +
  "M10.7 8.4h2.6v2.6h-2.6Z" +
  "M14.8 8.4h2.6v2.6h-2.6Z" +
  "M6.6 13h2.6v2.6H6.6Z" +
  "M10.7 13h2.6v2.6h-2.6Z" +
  "M14.8 13h2.6v2.6h-2.6Z";
const M_LIFE =
  "M7.6 6.6h8.8v2.2c0 1.9-1.1 3-2.6 3.2 1.5.2 2.6 1.3 2.6 3.2v2.2H7.6v-2.2c0-1.9 1.1-3 2.6-3.2-1.5-.2-2.6-1.3-2.6-3.2Z";
const M_ASSISTANT =
  "M12 6.2l1.55 4.25L17.8 12l-4.25 1.55L12 17.8l-1.55-4.25L6.2 12l4.25-1.55Z";

export const HomeGlyph = (p: IconProps) => <Tile mark={M_HOME} {...p} />;
export const TasksGlyph = (p: IconProps) => <Tile mark={M_TASKS} {...p} />;
export const NotesGlyph = (p: IconProps) => <Tile mark={M_NOTES} {...p} />;
export const HabitsGlyph = (p: IconProps) => <Tile mark={M_HABITS} {...p} />;
export const GoalsGlyph = (p: IconProps) => <Tile mark={M_GOALS} {...p} />;
export const ProjectsGlyph = (p: IconProps) => (
  <Tile mark={M_PROJECTS} {...p} />
);
export const CalendarGlyph = (p: IconProps) => (
  <Tile mark={M_CALENDAR} {...p} />
);
export const LifeCalendarGlyph = (p: IconProps) => (
  <Tile mark={M_LIFE} {...p} />
);
export const AssistantGlyph = (p: IconProps) => (
  <Tile mark={M_ASSISTANT} {...p} />
);

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
