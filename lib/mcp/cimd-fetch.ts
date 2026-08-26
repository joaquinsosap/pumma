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
import { Readable } from "node:stream";
import { isPublicRoutableHost } from "@better-auth/core/utils/host";

/** Statuses whose responses must not carry a body. */
const BODYLESS = new Set([101, 103, 204, 205, 304]);

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
        const body =
          req.method === "HEAD" || BODYLESS.has(status)
            ? null
            : (Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>);
        // Handed back as-is. A 3xx is a refusal, not something to follow:
        // following one would connect somewhere the pinned address never
        // validated.
        resolve(
          new Response(body, {
            headers: toHeaders(response.headers),
            status,
            statusText: response.statusMessage,
          }),
        );
      },
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}
