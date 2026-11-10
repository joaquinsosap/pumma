// Telling this site's own pages from somebody else's, for routes that act on a session.

/**
 * Whether a request that changes or reads something came from this site's own
 * pages. The session cookie is already withheld from other sites' requests; a
 * page on a sibling address under the same domain is the case that leaves, and
 * the browser names where a request came from in `Origin`. No `Origin` at all
 * is a request no browser page made (a script with the cookie in hand), which
 * the cookie rules were never a defence against.
 */
export function sameSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  let from: string;
  try {
    from = new URL(origin).host;
  } catch {
    return false;
  }
  const hosts = [req.headers.get("x-forwarded-host"), req.headers.get("host")]
    .flatMap((h) => (h ? h.split(",") : []))
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return hosts.includes(from.toLowerCase());
}
