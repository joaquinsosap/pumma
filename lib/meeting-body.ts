// Making a calendar invite readable.
//
// A meeting body from Teams, Zoom or Meet is not prose. It is a generated
// block carrying a join link, an ID, a passcode, and several paragraphs of
// boilerplate, and it arrives wearing three layers of encoding:
//
//   1. `label<https://actual.url>` — the plain-text rendering of an HTML
//      anchor, which is why a raw dump reads "Need help?<https://...>".
//   2. Microsoft safelinks — the real destination buried in a `url=` query
//      parameter of an eur03.safelinks.protection.outlook.com address, with
//      a few hundred characters of tracking after it.
//   3. Rules made of underscores, standing in for <hr>.
//
// Pure text in, structure out. No DOM, no network, so the awkward cases are
// testable and the UI just renders what it is handed.

export type ConferenceKind = "teams" | "zoom" | "meet" | "webex";

export type ConferenceLink = {
  kind: ConferenceKind;
  url: string;
  label: string;
};

export type MeetingBody = {
  /** The one button worth showing, when there is one. */
  conference: ConferenceLink | null;
  /** "Meeting ID", "Passcode" and friends, in the order found. */
  details: { label: string; value: string }[];
  /** Who called it, when the invite says. */
  organizer: string | null;
  /** Everyone invited, names only. Often long; the UI folds it. */
  invitees: string[];
  /** What is left once the machinery is taken out, as readable paragraphs. */
  text: string;
};

/**
 * MIME encoded-words, as forwarded invites carry them.
 *
 * A name with an accent arrives as `=?utf-8?Q?Am=C3=A9ndola?=` because the
 * mail layer could not put it in a header as-is. Rendering that verbatim is
 * how "Mauricio Améndola" becomes line noise in a list of invitees.
 */
export function decodeEncodedWords(text: string): string {
  return text.replace(
    /=\?([\w-]+)\?([QqBb])\?([^?]*)\?=/g,
    (whole, charset, encoding, payload) => {
      try {
        const bytes =
          encoding.toUpperCase() === "B"
            ? Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
            : Uint8Array.from(
                payload
                  .replace(/_/g, " ")
                  .replace(/=([0-9A-Fa-f]{2})/g, (_m: string, hex: string) =>
                    String.fromCharCode(parseInt(hex, 16)),
                  ),
                (c: string) => c.charCodeAt(0),
              );
        return new TextDecoder(charset || "utf-8").decode(bytes);
      } catch {
        return whole;
      }
    },
  );
}

const CONFERENCE_LABEL: Record<ConferenceKind, string> = {
  teams: "Join Teams meeting",
  zoom: "Join Zoom meeting",
  meet: "Join Google Meet",
  webex: "Join Webex meeting",
};

/**
 * The real destination behind a safelinks wrapper.
 *
 * Left alone if it is not one: this is called on every URL found, and a
 * wrapper that has already been unwrapped must not be mangled a second time.
 */
export function unwrapSafelink(url: string): string {
  try {
    const u = new URL(url);
    if (!/safelinks\.protection\.outlook\.com$/i.test(u.hostname)) return url;
    const inner = u.searchParams.get("url");
    if (!inner) return url;
    // Doubly-encoded in practice: the parameter is percent-encoded, and the
    // value inside it often is again.
    const once = decodeURIComponent(inner);
    return once;
  } catch {
    return url;
  }
}

function classify(url: string): ConferenceKind | null {
  let host: string;
  let path: string;
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return null;
  }
  if (host.endsWith("teams.microsoft.com") || host.endsWith("teams.live.com"))
    return "teams";
  if (host.endsWith("zoom.us") || host.endsWith("zoom.com")) return "zoom";
  if (host === "meet.google.com") return "meet";
  if (host.endsWith("webex.com")) return "webex";
  // A Meet link can also arrive as a google.com redirect.
  if (host.endsWith("google.com") && path.startsWith("/meet")) return "meet";
  return null;
}

/**
 * Every URL in a blob, most trustworthy first.
 *
 * Markdown links come first deliberately. A forwarded invite renders the call
 * as `[https://zoom.us/j/819](https://zoom.us/j/81906789196)`, where the LABEL
 * is truncated for display and only the target is complete — so scanning
 * left to right finds the short one and produces a join button that 404s.
 * The thing in the parentheses is the link; the thing in the brackets is
 * what it looked like.
 */
function urlsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) out.push(m[1]);
  // Deliberately greedy about what a URL may contain, then trimmed below:
  // these carry commas, parens and percent escapes, and a conservative
  // pattern truncates them mid-token, which produces a link that 404s.
  const re = /https?:\/\/[^\s<>"']+/g;
  for (const m of text.matchAll(re)) {
    // Trailing punctuation belongs to the sentence, not the URL.
    out.push(m[0].replace(/[.,;:>)\]]+$/, ""));
  }
  return out;
}

/**
 * The join link, if this invite has one.
 *
 * Preference order matters: a Teams invite mentions its own domain several
 * times (join, help, meeting options, system reference) and only the first is
 * the thing you press. Unwrapping happens BEFORE classifying, because through
 * a safelink every one of those is an outlook.com URL.
 */
export function findConferenceLink(text: string): ConferenceLink | null {
  for (const raw of urlsIn(text)) {
    const url = unwrapSafelink(raw);
    const kind = classify(url);
    if (!kind) continue;
    // "aka.ms/JoinTeamsMeeting" is the help page, not a meeting.
    if (/aka\.ms/i.test(url)) continue;
    return { kind, url, label: CONFERENCE_LABEL[kind] };
  }
  return null;
}

/** Lines like "Meeting ID: 123 456" that are worth pulling out and keeping. */
const DETAIL_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "Meeting ID", re: /meeting\s*id:\s*([0-9 ]{6,})/i },
  { label: "Passcode", re: /pass(?:code|word):\s*(\S+)/i },
  { label: "Phone", re: /(?:dial|call)[^\n:]*:\s*(\+[\d\s()-]{7,})/i },
];

export function extractDetails(text: string): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const { label, re } of DETAIL_PATTERNS) {
    const m = text.match(re);
    if (m?.[1]) out.push({ label, value: m[1].trim() });
  }
  return out;
}

/**
 * The invite with its machinery removed.
 *
 * What goes: separator rules, the URLs themselves (the button and the details
 * carry those now), and the empty lines left behind. What stays: any sentence
 * a human wrote, which is the part a body is actually for and the part that
 * was impossible to find in the raw dump.
 */
export function cleanMeetingText(text: string): string {
  if (!text.trim()) return "";
  let out = text;

  // `[label](url)` and `label<url>` are both anchors. Keep the label only
  // when it is a word; a label that is itself a URL is just the link again.
  out = out.replace(/\[([^\]]*)\]\(https?:\/\/[^)\s]*\)/g, (_m, label) =>
    /^https?:\/\//.test(label) ? "" : label,
  );
  out = out.replace(/([^\s<>]*)<https?:\/\/[^>]*>/g, "$1");
  // Bare URLs left over.
  out = out.replace(/https?:\/\/[^\s<>"']+/g, "");
  // Rules made of underscores, dashes or equals, plus the shapes a forwarded
  // invite uses: "*~*~*~*~*", "----( Video Call )----", "---===---".
  out = out.replace(/^[_\-=]{4,}$/gm, "");
  out = out.replace(/[_]{6,}/g, "");
  out = out.replace(/^[*~\-=]{4,}$/gm, "");
  out = out.replace(/^-+\(\s*[^)]*\s*\)-+$/gm, "");
  out = out.replace(/^(?:\*~)+\*?$/gm, "");
  // The header block a forwarded request opens with. Organizer and invitees
  // are shown as their own fields now, and repeating them as prose is how a
  // three-line note ends up buried under a screen of addresses.
  out = out.replace(
    /^(the following is a new meeting request:?|subject:.*|organi[sz]er:.*|time:.*|location:.*|(?:invitees|attendees|required attendees|optional attendees):[\s\S]*?(?=\n\S|$))$/gim,
    "",
  );
  // The lines the details block now owns.
  out = out.replace(/^.*meeting\s*id:.*$/gim, "");
  out = out.replace(/^.*pass(?:code|word):.*$/gim, "");
  // Teams and Zoom boilerplate that says nothing to the person reading it.
  //
  // The leading `[|\-\u2022\s]*` is load-bearing: once an anchor is unwrapped these
  // lines read "| System reference", so a pattern anchored at the start of
  // the line matches none of them.
  out = out.replace(
    /^[|\-\u2022\s]*(need help\??|for organi[sz]ers:?.*|system reference.*|meeting options.*|join on your computer.*|download teams.*|learn more.*|dial in by phone.*|find a local number.*)\s*$/gim,
    "",
  );
  // A label whose value was a URL we just removed ("Join:", "Video call
  // link:") is now a word and a colon, saying nothing.
  out = out.replace(/^\s*[\w ]{0,24}:\s*$/gm, "");

  return (
    out
      .split(/\r?\n/)
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      // A line of leftover punctuation is not content, but it is not a reason
      // to close the gap either: blanked rather than dropped, so a paragraph
      // break written by a person survives being next to one.
      .map((l) => (/^[|·•\-–—:,.]+$/.test(l) ? "" : l))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** "Name <addr>, Name <addr>" as just the names, decoded and de-duplicated. */
function peopleFrom(line: string): string[] {
  return [
    ...new Set(
      decodeEncodedWords(line)
        .split(/,(?![^<]*>)/)
        .map((p) => p.replace(/<[^>]*>/g, "").trim())
        // Fall back to the address when there is no display name.
        .map((p) => p || "")
        .filter(Boolean),
    ),
  ];
}

/** Everything the UI needs from a meeting's body, in one pass. */
export function parseMeetingBody(text: string): MeetingBody {
  const source = text ?? "";
  const organizerLine = source.match(/^organi[sz]er:\s*(.+)$/im)?.[1] ?? "";
  const inviteeLine =
    source.match(/^(?:invitees|attendees|required attendees):\s*(.+)$/im)?.[1] ??
    "";
  return {
    conference: findConferenceLink(source),
    details: extractDetails(source),
    organizer: peopleFrom(organizerLine)[0] ?? null,
    invitees: peopleFrom(inviteeLine),
    text: cleanMeetingText(source),
  };
}
