// Minecraft's §k text: each character swapped for a random one of the same width, so the word keeps its size.

/** What a character can turn into: printable ASCII and Latin-1, like the game. */
export const OBFUSCATE_POOL: readonly string[] = (() => {
  const chars: string[] = [];
  for (let c = 33; c <= 126; c++) chars.push(String.fromCharCode(c));
  // 173 is the soft hyphen, which draws nothing.
  for (let c = 161; c <= 255; c++) if (c !== 173) chars.push(String.fromCharCode(c));
  return chars;
})();

export type WidthBuckets = {
  widthOf: Map<string, number>;
  byWidth: Map<number, string[]>;
};

/** Group characters by drawn width, rounded to half a pixel. */
export function bucketByWidth(
  chars: readonly string[],
  width: (ch: string) => number,
): WidthBuckets {
  const widthOf = new Map<string, number>();
  const byWidth = new Map<number, string[]>();
  for (const ch of chars) {
    const w = Math.round(width(ch) * 2) / 2;
    widthOf.set(ch, w);
    const group = byWidth.get(w);
    if (group) group.push(ch);
    else byWidth.set(w, [ch]);
  }
  return { widthOf, byWidth };
}

/**
 * One frame of scrambled text. Characters the buckets don't know (or every
 * character, before the font is measured) draw from the whole pool.
 */
export function obfuscate(
  text: string,
  buckets: WidthBuckets | null,
  random: () => number = Math.random,
): string {
  let out = "";
  for (const ch of text) {
    const w = buckets?.widthOf.get(ch);
    const same = (w !== undefined && buckets?.byWidth.get(w)) || OBFUSCATE_POOL;
    out += same[Math.floor(random() * same.length)];
  }
  return out;
}
