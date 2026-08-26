/**
 * Fetching a client's metadata document, with the guarantees CIMD requires.
 *
 * This replaces `fetchClientMetadataResource` from `@better-auth/cimd/node`,
 * which is broken on Node 20 and later. The vendor transport supplies a custom
 * `lookup` to pin the resolved address and calls back in the old three-argument
 * shape, `callback(null, address, family)`. Since Node 20, `net.connect`
 * defaults to Happy Eyeballs (`autoSelectFamily`), which calls `lookup` with
 * `{ all: true }` and expects an ARRAY back. Node then reads `addresses[0]`
 * off a plain string, gets `undefined`, and throws:
 *
 *     ERR_INVALID_IP_ADDRESS: Invalid IP address: undefined
 *
 * The authorization server turns that into `invalid_client: Failed to fetch
 * metadata document (network error or redirect blocked)`, which points at the
 * network and at redirects, neither of which is the problem. Confirmed in
 * production: the same request with `autoSelectFamily: false` returns 200,
 * and every attempt to connect Claude to PUMMA failed on it.
 *
 * The one real change is that the lookup callback now honours `options.all`.
 * Everything the spec cares about is kept, and the reasons are worth stating
 * because this is the one place the server fetches a URL chosen by an
 * unauthenticated stranger:
 *
 *   - HTTPS only
 *   - resolve the hostname EXACTLY ONCE, and pin the answer for the
 *     connection, so the address that was validated is the address that is
 *     connected to (no second resolution to poison)
 *   - every returned address must be public-routable, using the vendor's own
 *     checker, so a hostname that resolves to anything internal is refused
 *     outright rather than merely deprioritised
 *   - the original hostname stays the Host header, the TLS SNI, and the
 *     certificate identity, so pinning changes where we connect and never
 *     what we trust
 *   - redirects are returned to the caller, never followed
 */
import "server-only";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { isPublicRoutableHost } from "@better-auth/core/utils/host";

/** Statuses whose responses must not carry a body. */
const BODYLESS = new Set([101, 103, 204, 205, 304]);

/** A stranger's document; do not read an unbounded amount of it. */
const MAX_METADATA_BYTES = 256 * 1024;

/**
 * The grant types this server actually implements.
 *
 * Better Auth's defaults. Listed here rather than imported because the point
 * of the filter below is to compare a client's claims against what we can
 * really honour, and that is a decision worth stating in one place.
 */
const SUPPORTED_GRANT_TYPES = new Set([
  "authorization_code",
  "client_credentials",
  "refresh_token",
]);

/**
 * Drop grant types we do not implement, instead of refusing the client.
 *
 * Better Auth rejects an entire registration if the metadata names any grant
 * type it does not support, with `invalid_client_metadata: unsupported
 * grant_type ...`. Claude's connector advertises
 * `urn:ietf:params:oauth:grant-type:jwt-bearer` alongside the ordinary two,
 * so it could not register at all, even though the flow it actually performs
 * here is plain authorization_code plus refresh_token.
 *
 * RFC 7591 section 3.2.1 is explicit that a server MAY replace requested
 * registration values with suitable ones, so narrowing the list to the
 * intersection is allowed and is the interoperable choice. The alternative,
 * declaring jwt-bearer in our own `grantTypes`, would advertise it in
 * `grant_types_supported` and be a straightforward lie: nothing implements it,
 * and a client that believed us would fail at the token endpoint instead.
 *
 * Only `grant_types` is touched. Everything else, including redirect URIs and
 * the client name, is passed through exactly as published.
 */
export function narrowGrantTypes(metadata: unknown): {
  changed: boolean;
  metadata: unknown;
} {
  if (!metadata || typeof metadata !== "object") {
    return { changed: false, metadata };
  }
  const doc = metadata as Record<string, unknown>;
  const declared = doc.grant_types;
  if (!Array.isArray(declared)) return { changed: false, metadata };

  const kept = declared.filter(
    (g) => typeof g === "string" && SUPPORTED_GRANT_TYPES.has(g),
  );
  if (kept.length === declared.length) return { changed: false, metadata };

  // Refuse to hand back something unusable. If nothing survives, leave the
  // document alone and let the provider produce its own error: a client with
  // no grant type in common with us genuinely cannot be registered, and
  // silently rewriting it to look valid would hide that.
  if (kept.length === 0) return { changed: false, metadata };

  return { changed: true, metadata: { ...doc, grant_types: kept } };
}

function toHeaders(raw: NodeJS.Dict<string | string[]>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else if (value !== undefined) headers.append(key, value);
  }
  return headers;
}

export async function fetchClientMetadataResource(
  input: Request | string | URL,
  init?: RequestInit,
): Promise<Response> {
  const req = input instanceof Request ? input : new Request(input, init);
  const url = new URL(req.url);

  if (url.protocol !== "https:") {
    throw new TypeError("CIMD transport requires an HTTPS URL");
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    throw new TypeError("CIMD transport supports only GET and HEAD");
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new TypeError("metadata hostname returned no DNS addresses");
  }
  for (const a of addresses) {
    if (!isPublicRoutableHost(a.address)) {
      throw new TypeError(
        "metadata hostname must resolve only to public-routable addresses",
      );
    }
  }
  const pinned = addresses[0];

  const headers = Object.fromEntries(req.headers.entries());
  headers.host = url.host;

  return new Promise<Response>((resolve, reject) => {
    const outgoing = request(
      url,
      {
        agent: false,
        headers,
        method: req.method,
        // Bare hostname only: an IP literal is not a valid SNI value.
        servername:
          isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0
            ? url.hostname
            : undefined,
        signal: init?.signal ?? req.signal,
        lookup: (_hostname, options, callback) => {
          // The fix. Node asks for an array whenever it is doing Happy
          // Eyeballs, and for a bare address otherwise. Answer in whichever
          // shape was asked for; returning the wrong one is what produced
          // "Invalid IP address: undefined".
          const opts = (options ?? {}) as { all?: boolean };
          if (opts.all) {
            (callback as unknown as (
              err: NodeJS.ErrnoException | null,
              addresses: { address: string; family: number }[],
            ) => void)(null, [{ address: pinned.address, family: pinned.family }]);
          } else {
            callback(null, pinned.address, pinned.family);
          }
        },
      },
      (response) => {
        const status = response.statusCode ?? 500;
        const headers = toHeaders(response.headers);

        // A 3xx is a refusal, not something to follow: following one would
        // connect somewhere the pinned address never validated.
        if (req.method === "HEAD" || BODYLESS.has(status) || status >= 300) {
          resolve(
            new Response(null, {
              headers,
              status,
              statusText: response.statusMessage,
            }),
          );
          return;
        }

        // Buffered rather than streamed, because the document has to be read
        // to narrow its grant types, and because a document from a stranger
        // should have a size limit rather than being piped wholesale.
        const chunks: Buffer[] = [];
        let size = 0;
        let aborted = false;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_METADATA_BYTES) {
            aborted = true;
            response.destroy();
            reject(
              new TypeError(
                `client metadata document exceeds ${MAX_METADATA_BYTES} bytes`,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.once("error", reject);
        response.once("end", () => {
          if (aborted) return;
          const raw = Buffer.concat(chunks).toString("utf8");
          let body = raw;
          try {
            const { changed, metadata } = narrowGrantTypes(JSON.parse(raw));
            if (changed) body = JSON.stringify(metadata);
          } catch {
            // Not JSON, or not shaped how we expect. Pass it through and let
            // the provider judge it; this transport does not get to decide
            // what a valid metadata document looks like.
          }
          // Length changes when the document is rewritten, and a stale
          // content-length would truncate it.
          headers.delete("content-length");
          resolve(
            new Response(body, {
              headers,
              status,
              statusText: response.statusMessage,
            }),
          );
        });
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}
