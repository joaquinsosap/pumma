// Vetting a URL the server is about to fetch on a user's behalf.
//
// This is the security surface of calendar subscriptions. The user hands us a
// string and the SERVER makes the request, which means an unchecked value can
// aim our own network position at things the user could never reach: other
// containers on the compose network, the VM's own ports, and the cloud
// metadata endpoint at 169.254.169.254, which on most providers will hand out
// instance credentials to anything that asks.
//
// Two layers, because either alone is insufficient:
//
//   1. This file rejects what is wrong on its face (wrong scheme, an address
//      literal in a private range, a hostname that cannot be public).
//   2. The fetcher re-checks the RESOLVED address before connecting, because
//      "calendar.example.com" is free to resolve to 127.0.0.1, and a name can
//      resolve differently on the second lookup than the first.
//
// Pure and dependency-free so it can be tested exhaustively.

export type FeedUrlVerdict =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/** webcal:// is what calendars actually put on the "subscribe" button. */
function normaliseScheme(raw: string): string {
  const t = raw.trim();
  if (/^webcal:\/\//i.test(t)) return t.replace(/^webcal:\/\//i, "https://");
  return t;
}

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, Number(m[2]), Number(m[3]), Number(m[4])].some((n) => n > 255))
    return true; // malformed: refuse rather than interpret
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // "this network"
  if (a === 169 && b === 254) return true; // link-local AND cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local
  if (h.startsWith("fe80")) return true; // link-local
  // IPv4-mapped addresses: an IPv4 address wearing an IPv6 hat.
  //
  // Both spellings have to be handled, and the second one is the one that
  // matters: the URL parser NORMALISES "::ffff:127.0.0.1" to "::ffff:7f00:1",
  // so a check written against the dotted form never fires on anything that
  // has been through `new URL()`. Which is everything.
  const dotted = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return isPrivateIpv4(dotted[1]);

  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isPrivateIpv4(
      `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`,
    );
  }
  return false;
}

/** True for any host we must never connect to, given only its text. */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  // Names that only mean something inside a network we are already inside:
  // .local is mDNS, .internal is what cloud providers hand out, and a bare
  // single-label name resolves against the container's own search domain.
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home"))
    return true;
  if (!h.includes(".") && !h.includes(":")) return true;
  if (isPrivateIpv4(h)) return true;
  if (isPrivateIpv6(host)) return true;
  return false;
}

/**
 * Check a subscription URL before it is ever stored.
 *
 * Returns the normalised URL on success, so callers store the thing that will
 * actually be fetched rather than what was typed.
 */
export function vetFeedUrl(raw: string): FeedUrlVerdict {
  const candidate = normaliseScheme(raw ?? "");
  if (!candidate) return { ok: false, reason: "Paste a calendar URL." };
  if (candidate.length > 2048)
    return { ok: false, reason: "That URL is too long to be real." };

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "That does not look like a URL." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "Only http and https links can be used." };
  }
  // Credentials in the URL would be sent onward by the fetcher and stored in
  // our database; a feed that needs them is not a feed we support.
  if (url.username || url.password) {
    return { ok: false, reason: "Remove the username and password from the URL." };
  }
  if (isBlockedHost(url.hostname)) {
    return { ok: false, reason: "That address is not reachable from PUMMA." };
  }
  return { ok: true, url: url.toString() };
}
