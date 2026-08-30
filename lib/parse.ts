import * as chrono from "chrono-node";
import type { Tag } from "@/lib/schemas";
import type { OmniType } from "@/lib/types";
import {
  RESERVED_PRIORITY,
  RESERVED_TYPE,
  RESERVED_MODE,
  RESERVED_DATE,
} from "@/lib/omni-reserved";
import { iso, defaultNoteTitle, fakeLocalFromTz } from "@/lib/date";
import {
  isDateToken,
  resolveDateToken,
  type DateOrder,
} from "@/lib/date-tokens";
import { getDefaultTimezone } from "@/lib/timezone";

/** Preview color for #tags that do not exist yet (created on save). */
export const NEW_TAG_PREVIEW_COLOR = "oklch(0.58 0.06 265)";

/**
 * What a "#" can be followed by.
 *
 * Widened past [\w-] for numeric dates — "#25/12" has to be one token, not a
 * tag called "25" next to some punctuation. Tag names can't contain / . so
 * nothing that was a tag before parses differently now.
 */
export const OMNI_TOKEN_RE = /#([a-z0-9][\w./-]*)/gi;
/** The same thing, anchored to the end, for "what am I typing right now". */
export const OMNI_TOKEN_END_RE = /#([a-z0-9][\w./-]*)$/i;

export type ParseResult = {
  title: string;
  tagIds: string[];
  pills: { name: string; color: string; isNew?: boolean }[];
  pendingTag: { name: string; color: string; isNew: boolean } | null;
  newTagNames: string[];
  due: string | null;
  dateLabel: string | null;
  priority: "low" | "med" | "high";
  hasPriorityToken: boolean;
  /** Everything after "title: ", the way note capture splits title from body. */
  description: string;
  /** "#note" / "#goal" — the capture bar switches type when this is set. */
  typeToken: OmniType | null;
  /** "#plan" / "#ask" — switches the bar out of capture mode. */
  modeToken: "plan" | "ask" | null;
};

export type NoteParseResult = {
  title: string;
  body: string;
  tagIds: string[];
  newTagNames: string[];
};

type ParseOptions = {
  /** Skip date/priority parsing — for note capture */
  forNote?: boolean;
  /** How "#7/8" is read. From settings; day-first unless told otherwise. */
  dateOrder?: DateOrder;
};

export function parseOmni(
  text: string,
  tags: Tag[],
  referenceDate?: Date,
  options?: ParseOptions,
  timeZone?: string,
): ParseResult {
  const tz = timeZone ?? getDefaultTimezone();
  const ref = referenceDate ?? fakeLocalFromTz(new Date(), tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateOrder = options?.dateOrder ?? "dmy";
  let title = text;
  const tagIds: string[] = [];
  const pills: ParseResult["pills"] = [];

  // "#high", "#note", "#ask", "#today" steer the capture bar rather than
  // labelling anything, so they're pulled out before tags are collected and
  // never reach tagIds. They can't exist as tag names either — see
  // isReservedTagName.
  let typeToken: OmniType | null = null;
  let modeToken: "plan" | "ask" | null = null;
  let priorityToken: "low" | "med" | "high" | null = null;
  let dateToken: string | null = null;

  const tagMatches = [...text.matchAll(new RegExp(OMNI_TOKEN_RE.source, "gi"))];
  for (const m of tagMatches) {
    const name = m[1].toLowerCase();

    if (!options?.forNote) {
      if (RESERVED_TYPE[name]) {
        typeToken = RESERVED_TYPE[name];
        continue;
      }
      if (RESERVED_MODE[name]) {
        modeToken = RESERVED_MODE[name];
        continue;
      }
      if (RESERVED_PRIORITY[name]) {
        priorityToken = RESERVED_PRIORITY[name];
        continue;
      }
      // Any "#" that resolves to a date is a date, not a tag — words like
      // "#friday" and shapes like "#25/12" alike.
      if (resolveDateToken(name, ref, dateOrder)) {
        dateToken = name;
        continue;
      }
    }

    const existing = tags.find((t) => t.name === name);
    if (existing) {
      if (!tagIds.includes(existing.id)) {
        tagIds.push(existing.id);
        pills.push({ name: existing.name, color: existing.color });
      }
    } else {
      pills.push({ name, color: NEW_TAG_PREVIEW_COLOR, isNew: true });
    }
  }
  title = title
    .replace(new RegExp(OMNI_TOKEN_RE.source, "gi"), "")
    .replace(/\s+/g, " ")
    .trim();

  let priority: "low" | "med" | "high" = priorityToken ?? "med";
  // TODO: the "!high" form predates "#high" and is kept only so existing
  // muscle memory keeps working. Drop it once "#" is the only prefix.
  if (!options?.forNote) {
    const pm = text.match(/!(high|med|low|h|m|l)\b/i);
    if (pm) {
      const x = pm[1].toLowerCase();
      priority = x[0] === "h" ? "high" : x[0] === "l" ? "low" : "med";
      title = title
        .replace(/!(high|med|low|h|m|l)\b/i, "")
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  let due: string | null = null;
  let dateLabel: string | null = null;
  if (!options?.forNote && dateToken) {
    const hit = resolveDateToken(dateToken, ref, dateOrder);
    if (hit) {
      due = hit.date;
      dateLabel = hit.label;
    }
  }
  if (!options?.forNote && !due) {
    const parsed = chrono.parse(text, ref, { forwardDate: true });
    if (parsed.length > 0) {
      const result = parsed[0];
      const dd = result.start.date();
      // The omnibar sets a due DATE, never a time of day, even when chrono
      // heard one ("standup at 3pm" still just lands on today). A task only
      // carries a time when it was set explicitly on the task itself, in
      // TaskDetailPanel's time field.
      const datePart = `${dd.getFullYear()}-${pad(dd.getMonth() + 1)}-${pad(dd.getDate())}`;
      due = datePart;
      const label = result.text.trim();
      dateLabel = label.charAt(0).toUpperCase() + label.slice(1);
      title = title.replace(result.text, "").replace(/\s+/g, " ").trim();
    }
  }

  const newTagNames = pills.filter((p) => p.isNew).map((p) => p.name);

  let pendingTag: ParseResult["pendingTag"] = null;
  const pendingMatch = text.match(OMNI_TOKEN_END_RE);
  if (pendingMatch) {
    const name = pendingMatch[1].toLowerCase();
    if (!pills.some((p) => p.name === name)) {
      const existing = tags.find((t) => t.name === name);
      pendingTag = existing
        ? { name: existing.name, color: existing.color, isNew: false }
        : { name, color: NEW_TAG_PREVIEW_COLOR, isNew: true };
    }
  }

  const hasPriorityToken =
    priorityToken !== null || /!(high|med|low|h|m|l)\b/i.test(text);

  // "Pay rent: the landlord wants a transfer" — title before the colon, the
  // rest becomes the description, same idea as note capture. Runs last, on the
  // text left over once #tags, !priority and the date have been lifted out, so
  // "standup friday 9:00" splits on nothing (chrono already took the time) and
  // the tokens can sit on either side of the colon.
  // Note capture does its own splitting on the cleaned title, so don't consume
  // the colon out from under it.
  let description = "";
  if (!options?.forNote) {
    const split = splitDescription(title);
    title = split.title;
    description = split.description;
  }

  return {
    // Titles only. Whitespace either side of a title is never meant — it's
    // the space you typed before the tag you then deleted. A description or a
    // note body is prose and keeps whatever shape it was given.
    title: title.trim() || text.trim(),
    tagIds,
    pills,
    pendingTag,
    newTagNames,
    due,
    dateLabel,
    priority,
    hasPriorityToken,
    description,
    typeToken,
    modeToken,
  };
}

/**
 * Split "title: description" at the first colon that means it.
 *
 * Spacing is not the signal — "a:b", "a :b", "a: b" and "a : b" all split the
 * same way, because they're all the same thought typed at different speeds.
 */
export function splitDescription(text: string): {
  title: string;
  description: string;
} {
  const at = descriptionColonIndex(text);
  if (at === null) return { title: text, description: "" };
  return {
    title: text.slice(0, at).trim(),
    description: text.slice(at + 1).trim(),
  };
}

/**
 * The opening words of a note, for when the capture never named a title.
 *
 * A note called "New note 12/08 - 14:32" tells you nothing in a list of forty
 * of them; the first few words almost always do, because people start a note
 * with what it is about. Same trick a phone's notes app plays, and for the
 * same reason.
 *
 * Only the first line, because a title that runs across a paragraph break is
 * not a title. Trailing punctuation goes when the text was cut short, so it
 * reads as an opening rather than a sentence with its end lopped off.
 *
 * Returns "" for an empty body — the caller decides what to fall back to.
 */
export function noteTitleFromBody(body: string, maxWords = 8): string {
  const firstLine = body.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (!firstLine) return "";

  const words = firstLine.split(/\s+/);
  let title = words.slice(0, maxWords).join(" ");
  // A wall of characters with no spaces in it would otherwise sail past the
  // word count and take the whole line with it.
  const clipped = title.length > 72;
  if (clipped) title = title.slice(0, 72).trimEnd();

  return words.length > maxWords || clipped
    ? `${title.replace(/[.,;:!?—-]+$/, "")}…`
    : title;
}

/**
 * Note capture: `Title: body` sets both; otherwise the first words become the
 * title, falling back to a timestamp when there are no words to take.
 */
export function parseNoteCapture(
  text: string,
  tags: Tag[],
  referenceDate?: Date,
  timeZone?: string,
): NoteParseResult {
  const p = parseOmni(text, tags, referenceDate, { forNote: true }, timeZone);
  const cleaned = p.title.trim();
  const colonIdx = descriptionColonIndex(cleaned) ?? -1;

  if (colonIdx > 0) {
    const noteTitle = cleaned.slice(0, colonIdx).trim();
    const body = cleaned.slice(colonIdx + 1).trim();
    if (noteTitle) {
      return {
        title: noteTitle,
        body,
        tagIds: p.tagIds,
        newTagNames: p.newTagNames,
      };
    }
  }

  return {
    title:
      noteTitleFromBody(cleaned) ||
      defaultNoteTitle(
        referenceDate ??
          fakeLocalFromTz(new Date(), timeZone ?? getDefaultTimezone()),
        timeZone,
      ),
    body: cleaned,
    tagIds: p.tagIds,
    newTagNames: p.newTagNames,
  };
}

export function defaultDue(
  parsedDue: string | null,
  defaultDueToday: boolean,
  today: string = iso(),
): string | null {
  if (parsedDue) return parsedDue;
  if (defaultDueToday) return today;
  return null;
}

export function tagBg(color: string): string {
  if (color.startsWith("#")) return "var(--chip)";
  return color.replace(")", " / 0.12)");
}

export function toggleTagInText(text: string, tagName: string): string {
  const pattern = new RegExp(`#${tagName}\\b`, "gi");
  if (pattern.test(text)) {
    return text.replace(pattern, "").replace(/\s+/g, " ").trim();
  }
  const trimmed = text.trim();
  return trimmed ? `${trimmed} #${tagName}` : `#${tagName}`;
}

export type OmniInputToken =
  | { kind: "text"; text: string; dim?: boolean }
  | {
      kind: "tag";
      text: string;
      name: string;
      color: string;
      isNew: boolean;
    }
  | { kind: "priority"; text: string; level: "low" | "med" | "high" }
  | { kind: "date"; text: string };

/** Split omnibar text into plain text + inline #tag / !prio tokens for overlay rendering. */
export function tokenizeOmniInput(
  text: string,
  tags: Tag[],
  options?: { showTags?: boolean; showPriority?: boolean },
): OmniInputToken[] {
  const showTags = options?.showTags !== false;
  const showPriority = options?.showPriority !== false;

  type Match = { start: number; end: number; token: OmniInputToken };
  const matches: Match[] = [];

  if (showTags) {
    for (const m of text.matchAll(new RegExp(OMNI_TOKEN_RE.source, "gi"))) {
      if (m.index === undefined) continue;
      const name = m[1].toLowerCase();
      // A date is not a tag it hasn't heard of — it gets its own colour, or
      // "#friday" reads as a tag you are about to create.
      if (isDateToken(name)) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          token: { kind: "date", text: m[0] },
        });
        continue;
      }
      const existing = tags.find((t) => t.name === name);
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        token: {
          kind: "tag",
          text: m[0],
          name,
          color: existing?.color ?? NEW_TAG_PREVIEW_COLOR,
          isNew: !existing,
        },
      });
    }
  }

  if (showPriority) {
    for (const m of text.matchAll(/!(high|med|low|h|m|l)\b/gi)) {
      if (m.index === undefined) continue;
      const x = m[1].toLowerCase();
      const level: "low" | "med" | "high" =
        x[0] === "h" ? "high" : x[0] === "l" ? "low" : "med";
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        token: { kind: "priority", text: m[0], level },
      });
    }
  }

  matches.sort((a, b) => a.start - b.start);

  const segments: OmniInputToken[] = [];
  let cursor = 0;
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start < lastEnd) continue;
    if (m.start > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, m.start) });
    }
    segments.push(m.token);
    cursor = m.end;
    lastEnd = m.end;
  }
  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }

  const built: OmniInputToken[] = segments.length
    ? segments
    : text
      ? [{ kind: "text", text }]
      : [];
  return dimDescriptionAfterColon(built, text);
}

/**
 * Where "title: description" splits, in raw-text coordinates — the one place
 * the rule lives, so what looks like the title while you type is exactly what
 * gets stored as one.
 *
 * Any colon splits, spaced or not. The two that reliably mean something else
 * are skipped rather than banned: the one in a URL scheme, and the one in a
 * clock time. Skipping rather than giving up means "standup 14:30: bring the
 * numbers" still splits — at the second colon, where it should.
 *
 * A colon with nothing on one side of it isn't a split either, so a title
 * ending in one goes on being a title while you type the rest.
 */
export function descriptionColonIndex(text: string): number | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ":") continue;
    if (text.startsWith("//", i + 1)) continue;
    const before = text[i - 1];
    const after = text[i + 1];
    if (before && after && /\d/.test(before) && /\d/.test(after)) continue;
    if (!text.slice(0, i).trim() || !text.slice(i + 1).trim()) continue;
    return i;
  }
  return null;
}

/**
 * Set the description half of a "title: description" capture back from the
 * title.
 *
 * By colour, never by weight. This styling is painted on a layer sitting over
 * a transparent <input>, and the browser draws the caret and handles the
 * selection from the input's own text — so the two layers have to agree on
 * where every character is, to the pixel. Bold glyphs are wider than medium
 * ones, so bolding the title pushed the overlay right of the input beneath
 * it: the caret landed between the wrong letters and the text looked like it
 * was printing over itself. Colour costs nothing in advance width.
 *
 * Only plain text is dimmed; a tag or priority after the colon keeps its own
 * styling, which is fine — those aren't prose.
 */
function dimDescriptionAfterColon(
  segments: OmniInputToken[],
  text: string,
): OmniInputToken[] {
  const colon = descriptionColonIndex(text);
  if (colon === null) return segments;

  const out: OmniInputToken[] = [];
  let offset = 0;
  for (const token of segments) {
    const start = offset;
    const end = offset + token.text.length;
    offset = end;

    if (token.kind !== "text" || end <= colon) {
      out.push(token);
      continue;
    }
    if (start >= colon) {
      out.push({ ...token, dim: true });
      continue;
    }
    // The colon lands inside this run — split it so only the tail dims.
    const cut = colon - start;
    out.push({ kind: "text", text: token.text.slice(0, cut) });
    out.push({ kind: "text", text: token.text.slice(cut), dim: true });
  }
  return out;
}
