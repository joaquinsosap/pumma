// What the capture bar draws after the caret for a half-typed #tag or !priority: certain parts faint, undecided parts scrambled.

import {
  PRIORITY_WORDS,
  candidatesFor,
  commonPrefix,
  tokenAtCaret,
} from "@/lib/omni-complete";

export type OmniHint =
  /** One option: the letters Tab adds, or with `replace` the word Tab swaps in. */
  | { kind: "certain"; text: string; replace: boolean }
  /** Several options: the shared part, then the rest of the one Tab writes next. */
  | {
      kind: "open";
      known: string;
      unknown: string;
      replace: boolean;
      count: number;
      slot: number;
    }
  /** Tab has written a guess: which one of how many. */
  | { kind: "cycling"; position: number; count: number };

export type OmniHintOptions = {
  /** What "#" completes to: the user's tags and the bar's own words. */
  pool: string[];
  /** Type words ("task") that Tab swaps instead of completing. */
  typeWords: readonly string[];
  /** Tab's cycle, while the text before the caret is what Tab left: the word as typed and the option last written. */
  cycle?: { base: string; index: number } | null;
};

export function omniHint(
  text: string,
  start: number,
  end: number,
  { pool, typeWords, cycle }: OmniHintOptions,
): OmniHint | null {
  // Drawn after the text, so nothing may follow the caret.
  if (end !== text.length) return null;
  const token = tokenAtCaret(text, end);
  if (!token || !token.word) return null;
  const names = token.prefix === "#" ? pool : [...PRIORITY_WORDS];

  if (cycle) {
    const candidates = candidatesFor(cycle.base, names);
    if (candidates.length < 2) return null;
    if (start < end) {
      const at = candidates.indexOf(token.word);
      if (at !== -1) {
        return { kind: "cycling", position: at + 1, count: candidates.length };
      }
    }
    // Tab goes on from the option it last wrote, even after the guess is deleted.
    return openOn(token.word, candidates, (cycle.index + 1) % candidates.length);
  }
  if (start < end) return null;

  // "#task" spelled out: Tab swaps it for the next type.
  if (token.prefix === "#" && typeWords.includes(token.word)) return null;

  const candidates = candidatesFor(token.word, names);
  if (!candidates.length) return null;

  if (candidates.length === 1) {
    const only = candidates[0];
    if (!only.startsWith(token.word)) {
      return { kind: "certain", text: only, replace: true };
    }
    const rest = only.slice(token.word.length);
    return rest ? { kind: "certain", text: rest, replace: false } : null;
  }

  // Same first pick as completeOmniToken: the shared part fills first, then the list starts.
  const shared = commonPrefix(candidates);
  const fills = shared.length > token.word.length && shared.startsWith(token.word);
  const at = candidates.indexOf(token.word);
  return openOn(
    token.word,
    candidates,
    fills || at === -1 ? 0 : (at + 1) % candidates.length,
  );
}

function openOn(typed: string, candidates: string[], next: number): OmniHint {
  const target = candidates[next];
  const shared = commonPrefix(candidates);
  const known =
    shared.length > typed.length && shared.startsWith(typed)
      ? shared.slice(typed.length)
      : "";
  const written = typed + known;
  const replace = !target.startsWith(written);
  return {
    kind: "open",
    known: replace ? "" : known,
    unknown: replace ? target : target.slice(written.length),
    replace,
    count: candidates.length,
    slot: next,
  };
}
