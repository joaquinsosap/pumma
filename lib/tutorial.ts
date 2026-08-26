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
  | "sync"
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
  /**
   * How tall this beat's card should be.
   *
   * Declared per beat rather than measured. One fixed height for all of them
   * left the sparse scenes floating in a third of a card of nothing, and
   * making it dynamic would put the stage back to resizing itself around
   * content that changes mid-beat, which is what the fixed height was for.
   * A number per scene is the middle: known before it renders, so the change
   * between beats is one small animation rather than a negotiation.
   */
  stage?: number;
  /** Missions only — the confirmation once it lands. */
  done?: string;
};

export const BEATS: Beat[] = [
  // The copy is deliberately short. Every one of these lines competes with a
  // headline that changes on nearly every keystroke, a key hint, and a scene
  // that is doing the actual teaching — and a line nobody finishes reading
  // before it changes teaches nothing at all. If a sentence can be a picture,
  // it is one; if it can be three words, it is three words.
  {
    id: "type",
    kind: "do",
    step: "Capture",
    caption: "Just type. No clicking.",
    sub: "A day and a #tag, in the same line.",
    done: "One bar. Three places.",
    stage: 430,
  },
  {
    id: "tab",
    kind: "do",
    step: "Switch",
    caption: "Tab changes what you're making.",
    sub: "One bar for everything.",
    done: "Task, habit, goal, note, assistant.",
    stage: 320,
  },
  {
    id: "tag",
    kind: "do",
    step: "File it",
    caption: "Tags are where things live.",
    sub: "Right-click to send it somewhere.",
    done: "It moved, and took its side of life with it.",
    stage: 300,
  },
  {
    id: "bulk",
    kind: "do",
    step: "Select",
    caption: "Pick many. Change them all.",
    sub: "Shift-click a range.",
    done: "They change together.",
    stage: 360,
  },
  // A watch beat on purpose. The gesture it would ask for is "paste a secret
  // URL", which is a terrible thing to ask of somebody sixty seconds into an
  // app, and the setting is one tap away once the tour is over. What this has
  // to do is make the feature KNOWN, and show that mirrored events and your
  // own live in one list without being confusable.
  {
    id: "sync",
    kind: "watch",
    step: "Link",
    caption: "Your other calendars, in here.",
    sub: "Read only. Nothing leaves PUMMA.",
    // Six, not eight. The watch budget has a 30 second ceiling and it was
    // already at 24; this beat has three moves and does not need longer.
    ms: 9_000,
    stage: 360,
  },
  // Two beats, because it was always two scenes. The assistant half asks a
  // question and gets an answer; the other half gives an instruction and gets
  // a draft. Counting them as one told you there were two things to watch
  // while you sat through three.
  {
    id: "ask",
    kind: "watch",
    step: "Ask",
    caption: "Ask about your own data.",
    sub: "It answers from what you have.",
    ms: 10_000,
    stage: 330,
  },
  {
    id: "request",
    kind: "watch",
    step: "Tell it",
    caption: "Or tell it what to change.",
    sub: "Nothing saves until you say so.",
    ms: 11_000,
    stage: 330,
  },
  {
    id: "life",
    kind: "watch",
    step: "Your weeks",
    caption: "Your life in weeks.",
    sub: "1,521 down.",
    ms: 12_000,
    stage: 390,
  },
];

/** Missions can't be timed, so progress counts beats rather than seconds. */
export function progressAt(index: number, beats: Beat[] = BEATS): number {
  return Math.min(1, Math.max(0, index / beats.length));
}

/**
 * What the self-playing beats add up to.
 *
 * Longer than it was, on purpose. The old ceiling existed because a watch
 * beat was something you were STUCK in front of, so every extra second was a
 * second of somebody's life spent waiting. They now carry a Next control that
 * doubles as the clock, so the wait is both visible and skippable — and a
 * scene nobody can leave is the thing worth capping, not a scene that plays
 * for a few seconds longer while you actually look at it.
 */
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

/**
 * Whether the tour is switched off for this instance.
 *
 * Development and test only. The tour opens over whatever you are actually
 * working on, and every fresh account starts it again, so anything that
 * creates accounts (an automated run, a scratch database) spends its time
 * dismissing a modal. Read at runtime, defaults to off, so a real install
 * always gets the tour and this can never be enabled by accident at build.
 */
export function tutorialDisabled(): boolean {
  return process.env.SKIP_TUTORIAL === "1";
}
