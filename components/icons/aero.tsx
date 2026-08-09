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

function Aero({ d, strokeWidth: _sw, size: _size, ...rest }: IconProps & { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false" {...rest}>
      <defs>
        <linearGradient id="aeroGloss" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.62" />
          <stop offset="47%" stopColor="#fff" stopOpacity="0.17" />
          <stop offset="47%" stopColor="#000" stopOpacity="0.11" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0.26" />
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
