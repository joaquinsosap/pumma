// The tour, as data.
//
// Every beat earns its place by teaching something a person would not work out
// on their own. Filters, delete buttons and the settings page are deliberately
// absent: they have labels, and a tutorial that reads labels out loud is the
// kind people skip. What's here instead is the stuff that makes PUMMA PUMMA —
// type-anywhere capture, tags as filing rather than labelling, and an
// assistant that proposes instead of doing.
//
// Two kinds of beat:
//
//   "do"    — a mission. The user performs the real gesture (types, presses
//             Tab, right-clicks, ⌘-clicks) and the tour waits for it. Reading
//             about a keyboard shortcut teaches nobody; doing it once teaches
//             everybody.
//   "watch" — a scene that plays itself, for the things there is nothing to
//             press: an assistant answer needs a model behind it, and a life
//             calendar is a thing to look at.
//
// A mission has no duration. It ends when it's done.

export type BeatId =
  | "type"
  | "tab"
  | "tag"
  | "bulk"
  | "ask"
  | "request"
  | "life";

export type Beat = {
  id: BeatId;
  kind: "do" | "watch";
  /** Checklist label. Two words at most — it sits in a narrow column. */
  step: string;
  /** The big line on screen. */
  caption: string;
  /** The quieter second line: what to actually do, or why it matters. */
  sub: string;
  /** Watch beats only — how long the scene runs. */
  ms?: number;
  /** Missions only — the confirmation once it lands. */
  done?: string;
};

export const BEATS: Beat[] = [
  {
    id: "type",
    kind: "do",
    step: "Capture",
    caption: "Don't click anything. Just type.",
    sub: "Give it a day and a #tag. Try: pay rent friday #finance",
    done: "That's the whole capture flow.",
  },
  {
    id: "tab",
    kind: "do",
    step: "Switch",
    caption: "Tab changes what you're making.",
    sub: "Press Tab until the bar says goal, then hold it there.",
    done: "One bar for tasks, habits, goals, notes and the assistant.",
  },
  {
    id: "tag",
    kind: "do",
    step: "File it",
    caption: "A tag isn't a label. It's where the thing lives.",
    sub: "Right-click the task, or long-press on a phone, and send it somewhere.",
    done: "It moved, and took that place's side of life with it.",
  },
  {
    id: "bulk",
    kind: "do",
    step: "Select",
    caption: "Pick many. Change them all.",
    sub: "Shift-click a range, then move the lot of them at once.",
    done: "Whatever you select changes together.",
  },
  // Two beats, because it was always two scenes. The assistant half asks a
  // question and gets an answer; the other half gives an instruction and gets
  // a draft. Counting them as one told you there were two things to watch
  // while you sat through three.
  {
    id: "ask",
    kind: "watch",
    step: "Ask",
    caption: "Ask it about your own data.",
    sub: "It reads what you already have and answers from it.",
    ms: 7_000,
  },
  {
    id: "request",
    kind: "watch",
    step: "Tell it",
    caption: "Or tell it what to change.",
    sub: "It proposes. You edit. Nothing is saved until you say so.",
    ms: 8_000,
  },
  {
    id: "life",
    kind: "watch",
    step: "Your weeks",
    caption: "This is your life in weeks.",
    sub: "1,521 down. Spend the next one on purpose.",
    ms: 9_000,
  },
];

/** Missions can't be timed, so progress counts beats rather than seconds. */
export function progressAt(index: number, beats: Beat[] = BEATS): number {
  return Math.min(1, Math.max(0, index / beats.length));
}

/** What the self-playing beats add up to — the honest part of "60 seconds". */
export function watchMs(beats: Beat[] = BEATS): number {
  return beats.reduce(
    (sum, b) => sum + (b.kind === "watch" ? (b.ms ?? 0) : 0),
    0,
  );
}

/**
 * Characters revealed so far when typing `text`, given a watch beat's
 * progress. `startAt`/`endAt` bound the typing to part of the beat, so a line
 * can land early and the rest of the beat holds on it.
 */
export function typedChars(
  text: string,
  progress: number,
  startAt = 0,
  endAt = 1,
): string {
  if (progress <= startAt) return "";
  if (progress >= endAt) return text;
  const t = (progress - startAt) / (endAt - startAt);
  return text.slice(0, Math.round(t * text.length));
}

// ---------------------------------------------------------------------------
// Hold-to-confirm
//
// Landing on the right answer for a single frame proves you pressed a key.
// Staying there proves you read what it said. The Tab mission fills a meter
// while you're on `goal` and drains it faster than it fills once you leave —
// so overshooting costs you, and mashing Tab never gets you through.

export const HOLD_MS = 1400;
/** Leaving is quicker than arriving; a mashed key shouldn't creep forwards. */
const DRAIN_RATE = 2.2;

/** The meter after `dtMs` more milliseconds, clamped to 0–1. */
export function nextHold(
  hold: number,
  onTarget: boolean,
  dtMs: number,
): number {
  const delta = onTarget ? dtMs / HOLD_MS : -(dtMs * DRAIN_RATE) / HOLD_MS;
  return Math.min(1, Math.max(0, hold + delta));
}

// ---------------------------------------------------------------------------
// Knowing when to let someone go
//
// The tour can't be skipped, which is a joke as long as it stays short. It
// stops being one the moment somebody is genuinely stuck — so if a beat has
// been open a while AND the keyboard has been getting nowhere, the tour offers
// the door itself rather than waiting to be forced.

export const FLOUNDER_MS = 20_000;
/**
 * The capture mission is seven steps where the others are one or two, so the
 * same clock accused people of being stuck while they were working through it.
 */
export const FLOUNDER_MS_LONG = 30_000;
export const FLOUNDER_KEYS = 15;

/** How long this particular beat gets before the door is offered. */
export function flounderLimit(beatId: string): number {
  return beatId === "type" ? FLOUNDER_MS_LONG : FLOUNDER_MS;
}

/**
 * Either is enough. Fifteen keys that the step wasn't listening for is
 * someone hunting for the answer; a beat's worth of seconds without moving is
 * someone who has stopped looking. Requiring both meant the quietly-stuck —
 * reading the same line over and over, pressing nothing — were never offered
 * the door, which is exactly the person who needs it.
 */
export function isFloundering(
  msOnBeat: number,
  strayKeys: number,
  limitMs: number = FLOUNDER_MS,
): boolean {
  return msOnBeat >= limitMs || strayKeys >= FLOUNDER_KEYS;
}

// ---------------------------------------------------------------------------
// Mission checks — pure, so the rules sit in one readable place and can be
// tested without a DOM.

/** The date words the capture parser understands, for the first mission. */
const DAY_WORDS =
  /\b(today|tonight|tomorrow|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

export type CaptureCheck = {
  hasTitle: boolean;
  hasDay: boolean;
  hasTag: boolean;
  ok: boolean;
};

/**
 * The capture mission wants a title, a day and a tag — all three, not any of
 * them. The beat exists to show that the bar reads all of it at once, and
 * accepting two out of three would teach two thirds of the idea.
 */
export function checkCapture(text: string): CaptureCheck {
  const hasDay = DAY_WORDS.test(text);
  const hasTag = /#[a-z0-9-]{2,}/i.test(text);
  // Whatever is left once the tokens are lifted out is the title.
  const title = text
    .replace(/#[a-z0-9-]+/gi, " ")
    .replace(/![a-z]+/gi, " ")
    .replace(DAY_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
  const hasTitle = title.length >= 3;
  return { hasTitle, hasDay, hasTag, ok: hasTitle && hasDay && hasTag };
}
