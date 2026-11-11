/** A title this long was clipped for length (72 characters in lib/parse, less what the clip trimmed). */
const CLIPPED_FROM = 60;

/** What a note's card shows under its title: the note's text, minus the opening its title already says. */
export function notePreview(title: string, body: string): string {
  const text = body.trim();
  if (!text) return "";
  const name = title.trim();
  // A title cut from the text ends in an ellipsis (noteTitleFromBody in lib/parse).
  const cut = name.endsWith("…");
  const said = cut ? name.slice(0, -1).trim() : name;
  if (!said) return text;

  // Walk the text past the title's words, whatever spacing sits between them.
  let at = 0;
  for (const [i, word] of said.split(/\s+/).entries()) {
    const gap = /^[^\S\r\n]*/.exec(text.slice(at))![0].length;
    if (i > 0 && gap === 0) return text;
    at += gap;
    if (!text.startsWith(word, at)) return text;
    at += word.length;
  }

  const rest = text.slice(at);
  if (cut) {
    // Only a title clipped for length stops mid-word; a short one that does was typed, and is not this text's opening.
    if (/^[^\s.,;:!?—-]/.test(rest) && said.length < CLIPPED_FROM) return text;
    // The cut dropped the punctuation it stopped on (the same set as noteTitleFromBody), so the rest may start with it.
    return rest.replace(/^[\s.,;:!?—-]+/, "");
  }
  // A whole first line is the title only when the text ends there or breaks to a new line.
  return rest === "" || /^\s*[\r\n]/.test(rest) ? rest.trim() : text;
}
