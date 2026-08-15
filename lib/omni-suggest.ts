import {
  RESERVED_DATE,
  RESERVED_MODE,
  RESERVED_PRIORITY,
  RESERVED_TYPE,
} from "@/lib/omni-reserved";

/**
 * What the "#" you are halfway through typing could become.
 *
 * On a desktop this is Tab's job: type "#he", press Tab, get "#health". A
 * phone has no Tab, and the workaround — a strip of every tag you own, sitting
 * above the keyboard — asks you to hunt through a list that grows with your
 * tag count and never gets shorter. Completing as you type inverts that: three
 * letters usually leaves one candidate, and the candidate is a single tap.
 *
 * Ranked so the most specific thing wins. An exact name first, then your own
 * tags, then the words the bar itself claims (#high, #today, #note), then the
 * offer to make a new tag out of what you have typed. Your vocabulary before
 * ours, because you chose yours.
 */
export type SuggestionKind = "tag" | "reserved" | "new";

export type OmniSuggestion = {
  /** The word, without the "#". */
  word: string;
  kind: SuggestionKind;
  /** Colour for a tag chip, so the bar can look like the rest of the app. */
  color?: string;
};

/** The unfinished "#word" the caret sits in, if it is in one at all. */
export type ActiveToken = { start: number; end: number; fragment: string };

/**
 * A "#" counts as active while the caret is still inside the word it started.
 * A space ends it: "#work " is finished and completing it again would be
 * rewriting something the user already settled.
 */
export function activeToken(text: string, caret: number): ActiveToken | null {
  const upTo = text.slice(0, caret);
  const hash = upTo.lastIndexOf("#");
  if (hash < 0) return null;

  const fragment = upTo.slice(hash + 1);
  // Whitespace closes the token. So does a second "#", which starts a new one.
  if (/[\s#]/.test(fragment)) return null;
  // "#" alone is a valid start — it should offer everything.
  if (fragment && !/^[a-z0-9][\w./-]*$/i.test(fragment)) return null;

  return { start: hash, end: caret, fragment };
}

const RESERVED_ALL: string[] = [
  ...Object.keys(RESERVED_TYPE),
  ...Object.keys(RESERVED_PRIORITY),
  ...Object.keys(RESERVED_MODE),
  ...RESERVED_DATE,
];

/**
 * Completions for the token under the caret, best first.
 *
 * `limit` exists because this renders in one row on a phone: past about eight
 * the row becomes a scroll of its own and stops being faster than the keyboard.
 */
export function suggestCompletions(
  text: string,
  caret: number,
  tags: { name: string; color?: string }[],
  limit = 8,
): OmniSuggestion[] {
  const token = activeToken(text, caret);
  if (!token) return [];

  const fragment = token.fragment.toLowerCase();
  const seen = new Set<string>();
  const out: OmniSuggestion[] = [];

  const push = (word: string, kind: SuggestionKind, color?: string) => {
    const key = word.toLowerCase();
    if (seen.has(key) || out.length >= limit) return;
    seen.add(key);
    out.push({ word, kind, color });
  };

  const matching = <T extends { name: string }>(items: T[]) =>
    items.filter((i) => i.name.toLowerCase().startsWith(fragment));

  // An exact hit goes first even when other names extend it: someone who has
  // typed the whole of "#work" means "work", not "workshop".
  for (const tag of tags) {
    if (tag.name.toLowerCase() === fragment) push(tag.name, "tag", tag.color);
  }
  for (const tag of matching(tags)) push(tag.name, "tag", tag.color);
  for (const word of RESERVED_ALL) {
    if (word.toLowerCase().startsWith(fragment)) push(word, "reserved");
  }

  // Only offer to invent a tag once there is something to invent it from, and
  // never when it would duplicate a name that already exists.
  if (fragment && !seen.has(fragment)) push(token.fragment, "new");

  return out;
}

/**
 * Every tag, as the list to offer when nothing is being typed.
 *
 * The phone's bar shows this by default. It used to show the four capture
 * types instead, which the sheet already lists two inches below it — so the
 * one strip that is always within thumb reach spent itself repeating a
 * control rather than offering the thing you cannot otherwise reach without
 * typing "#" first.
 */
export function tagSuggestions(
  tags: { name: string; color?: string }[],
  limit = 12,
): OmniSuggestion[] {
  return tags
    .slice(0, limit)
    .map((tag) => ({ word: tag.name, kind: "tag" as const, color: tag.color }));
}

/**
 * The text after taking a suggestion, and where the caret should end up.
 *
 * Two jobs, because to the thumb pressing a chip they are the same gesture.
 * Mid-token it completes what is being typed. With no token under the caret
 * it appends the tag instead, which is what tapping "#health" while looking
 * at "pay rent" plainly means.
 *
 * Spacing is handled rather than left to the caller: a space goes in front
 * only when there is a word to separate from, and one always follows, because
 * the token is finished and the next keystroke should start something new
 * rather than extend the tag just chosen.
 */
export function applyCompletion(
  text: string,
  caret: number,
  suggestion: OmniSuggestion,
): { text: string; caret: number } {
  const token = activeToken(text, caret);

  const start = token ? token.start : caret;
  const end = token ? token.end : caret;
  const before = text.slice(0, start);
  const after = text.slice(end);

  // Pad on each side only where there is not already a space, so appending
  // to "pay rent" gains one, "pay rent " does not gain a second, and dropping
  // a tag into the middle of "pay rent| today" does not leave a gap.
  const leading = !token && before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trailing = /^\s/.test(after) ? "" : " ";
  const inserted = `${leading}#${suggestion.word}${trailing}`;

  return {
    text: `${before}${inserted}${after}`,
    caret: before.length + inserted.length,
  };
}
