/**
 * Making `http://localhost:PORT/callback` work for native OAuth clients.
 *
 * A CLI or desktop client cannot know its callback port in advance: it binds
 * an ephemeral one at the moment you start signing in. RFC 8252 section 7.3
 * covers exactly this and requires an authorization server to ignore the port
 * when matching a LOOPBACK redirect URI.
 *
 * Better Auth implements that, but only for IP literals. It excludes DNS names
 * like `localhost`, citing RFC 8252 section 8.3, which recommends clients use
 * the literal address because a hostname could in principle resolve elsewhere.
 * That reasoning is sound and its own registration validator disagrees with
 * it: `validateClientRedirectUri` explicitly ACCEPTS `http://localhost/...`
 * for native clients. So a client can register a localhost redirect and then
 * never be able to use one.
 *
 * Claude Code registers `http://localhost/callback` and asks for
 * `http://localhost:56126/callback`, so every attempt to connect it dies on
 * `invalid_redirect`. Reproduced locally against a real `claude mcp login`.
 *
 * The narrowest fix that keeps the library's rules intact is to hand it the
 * spelling it already accepts. `localhost` and `127.0.0.1` are the same
 * interface, and rewriting one to the other loses nothing: the request is
 * still confined to the loopback interface, still port-flexible only there,
 * and every other host is left untouched.
 *
 * Deliberately NOT a general redirect rewrite. It fires only when the scheme
 * is http and the host is exactly `localhost`, which is the one case the
 * library both permits at registration and refuses at use.
 */

/**
 * `http://localhost:PORT/x` becomes `http://127.0.0.1:PORT/x`. Anything else,
 * including https, a real hostname, or a URL that will not parse, is returned
 * exactly as given.
 */
export function normalizeLoopbackRedirect(redirectUri: string): string {
  if (!redirectUri) return redirectUri;
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    // Not our business to reject: let the provider produce its own error.
    return redirectUri;
  }
  if (url.protocol !== "http:") return redirectUri;
  if (url.hostname !== "localhost") return redirectUri;
  url.hostname = "127.0.0.1";
  return url.toString();
}

/** True when a rewrite would change something, for logging or tests. */
export function isLocalhostRedirect(redirectUri: string): boolean {
  return normalizeLoopbackRedirect(redirectUri) !== redirectUri;
}
