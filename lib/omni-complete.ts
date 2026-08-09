// Pure completion logic for the capture bar. No React, no DOM — the caller
// applies the result to the input.

/** Priority words the "!" prefix can complete to. */
export const PRIORITY_WORDS = ["high", "mid", "low"] as const;

export type OmniCompletion = {
  /** The whole text with the partial token completed. */
  text: string;
  /** Where the caret should land. */
  caret: number;
  /** What the token now reads as. */
  completion: string;
  /** True when one candidate remained and the token is finished. */
  exact: boolean;
};

/**
 * The partial "#tag" or "!prio" the caret is sitting at the end of.
 *
 * Only the token being typed is a candidate — completing something behind the
 * caret would rewrite text the user has moved on from.
 */
export function tokenAtCaret(
  text: string,
  caret: number,
): { prefix: "#" | "!"; word: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = before.match(/([#!])([a-z0-9-]*)$/i);
  if (!match) return null;
  return {
    prefix: match[1] as "#" | "!",
    word: match[2].toLowerCase(),
    start: caret - match[0].length,
  };
}

/** Everything that could still be meant by what's been typed. */
export function candidatesFor(word: string, pool: string[]): string[] {
  const lower = word.toLowerCase();
  const names = pool.map((c) => c.toLowerCase());
  const starts = names.filter((c) => c.startsWith(lower));
  // Only fall back to substring matches when nothing starts with it, so
  // "#art" doesn't drag in "smart-home" while a real prefix match exists.
  return starts.length ? starts : names.filter((c) => c.includes(lower));
}

/**
 * The longest prefix every candidate shares — how a shell completes.
 *
 * With "website-app" and "website-site" this returns "website-", which is
 * genuinely known, rather than guessing one of them.
 */
export function commonPrefix(words: string[]): string {
  if (!words.length) return "";
  let prefix = words[0];
  for (const word of words.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < word.length && prefix[i] === word[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
}

/**
 * Step the token at the caret on to the next capture type.
 *
 * Tab's first job is completing what you are typing. Once there is nothing
 * left to complete — the token is already "#task", spelled out in full — the
 * key is otherwise dead, and the only thing it can usefully mean is "not that
 * one, the next one". So "#task" becomes "#habit", then "#goal", then "#note",
 * then round again, and a bare "#" starts at the first.
 *
 * Returns null for anything mid-word: "#ta" still has a completion to offer
 * and this must not pre-empt it, and "#work" is a tag that has nothing to do
 * with types. Callers therefore try this only when they are not already part
 * way through cycling a token's candidates.
 *
 * No trailing space, unlike a settled completion — the whole point is that you
 * can press Tab again.
 */
export function cycleTypeAtCaret(
  text: string,
  caret: number,
  typeWords: string[],
  step = 1,
): OmniCompletion | null {
  if (!typeWords.length) return null;
  const n = typeWords.length;
  const at = (word: string) => typeWords.indexOf(word);
  const stepTo = (i: number) => typeWords[(((i + step) % n) + n) % n];

  const token = tokenAtCaret(text, caret);

  if (token) {
    if (token.prefix !== "#") return null;
    const i = at(token.word);
    // A word that is neither empty nor a type is somebody else's token.
    if (token.word && i === -1) return null;

    // i === -1 is the bare "#", and (-1 + 1) lands on the first type.
    const next = stepTo(i);
    const completed = `#${next}`;
    return {
      text: `${text.slice(0, token.start)}${completed}${text.slice(caret)}`,
      caret: token.start + completed.length,
      completion: next,
      exact: false,
    };
  }

  // Just settled: completing "#ta" writes "#task " with a trailing space, and
  // that space puts the token out of tokenAtCaret's reach. Pressing Tab again
  // there plainly means the same thing as pressing it a moment earlier, so the
  // settled token is reopened in place — space and caret left alone, since you
  // are still positioned to carry on writing prose.
  const settled = text.slice(0, caret).match(/#([a-z0-9-]+) $/i);
  if (!settled) return null;
  const i = at(settled[1].toLowerCase());
  if (i === -1) return null;

  const next = stepTo(i);
  const start = caret - settled[0].length;
  const completed = `#${next} `;
  return {
    text: `${text.slice(0, start)}${completed}${text.slice(caret)}`,
    caret: start + completed.length,
    completion: next,
    exact: false,
  };
}

/**
 * Complete the token at the caret.
 *
 * Fills in as far as every candidate agrees. If that lands on exactly one
 * candidate the token is finished and a space follows, so typing carries on in
 * the sentence rather than inside the tag. Otherwise the shared prefix goes in
 * and the caller can call again with `rotate` to cycle the options.
 *
 * `rotate` steps through the options — pressing Tab again cycles them one at a
 * time, the way a shell does rather than printing a list. It comes with
 * `baseWord`: the partial the user actually typed. Without it the second press
 * would narrow against the word the first press just wrote in, find one match,
 * and stop cycling after a single step.
 */
export function completeOmniToken(
  text: string,
  caret: number,
  tagNames: string[],
  rotate?: number,
  baseWord?: string,
): OmniCompletion | null {
  const token = tokenAtCaret(text, caret);
  if (!token || !token.word) return null;

  const pool = token.prefix === "#" ? tagNames : [...PRIORITY_WORDS];
  const typed = baseWord ?? token.word;
  const candidates = candidatesFor(typed, pool);
  if (!candidates.length) return null;

  const head = text.slice(0, token.start);
  const tail = text.slice(caret);

  const finish = (word: string, exact: boolean): OmniCompletion => {
    // A finished tag gets a trailing space so the next keystroke is prose.
    // Not when the tail already starts with one, or we'd double it.
    const space = exact && !tail.startsWith(" ") ? " " : "";
    const completed = `${token.prefix}${word}${space}`;
    return {
      text: `${head}${completed}${tail}`,
      caret: token.start + completed.length,
      completion: word,
      exact,
    };
  };

  // One option left is the only thing that ends a cycle: the tag is settled,
  // so it's written out in full with a space after it.
  if (candidates.length === 1) return finish(candidates[0], true);

  // Several options. Fill in what they all agree on first — that much is known
  // rather than guessed.
  const shared = commonPrefix(candidates);
  if (rotate === undefined && shared.length > token.word.length) {
    return finish(shared, false);
  }

  // Otherwise cycle. Landing on a candidate exactly doesn't stop anything
  // while others remain — "#web" with "web" and "website" keeps alternating,
  // and only space or enter (which change the text) end it.
  let index = rotate;
  if (index === undefined) {
    const at = candidates.indexOf(token.word);
    index = at === -1 ? 0 : at + 1;
  }
  return finish(candidates[index % candidates.length], false);
}
