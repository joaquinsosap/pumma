// Client metadata is written by whoever wants to connect, and it names grant
// types the client "can use". Better Auth rejects the whole registration if
// any of them is one it does not implement, so a client advertising an extra
// grant it will never exercise here cannot register at all. That is what
// stopped Claude's connector: it lists jwt-bearer next to the ordinary two,
// and got `invalid_client_metadata: unsupported grant_type`.
//
// RFC 7591 section 3.2.1 lets a server replace requested registration values,
// so narrowing to the intersection is both allowed and the interoperable
// choice. These pin that narrowing, including the cases where it must NOT act.
import { describe, expect, it } from "vitest";
import { narrowGrantTypes } from "@/lib/mcp/cimd-fetch";

const doc = (grants: unknown) => ({
  client_id: "https://example.test/meta",
  client_name: "Example",
  redirect_uris: ["http://localhost/callback"],
  grant_types: grants,
  response_types: ["code"],
});

describe("narrowing declared grant types", () => {
  it("drops the ones we do not implement", () => {
    const { changed, metadata } = narrowGrantTypes(
      doc([
        "authorization_code",
        "refresh_token",
        "urn:ietf:params:oauth:grant-type:jwt-bearer",
      ]),
    );
    expect(changed).toBe(true);
    expect((metadata as { grant_types: string[] }).grant_types).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
  });

  it("leaves a document alone when everything is supported", () => {
    const input = doc(["authorization_code", "refresh_token"]);
    const { changed, metadata } = narrowGrantTypes(input);
    expect(changed).toBe(false);
    expect(metadata).toBe(input);
  });

  it("changes nothing except grant_types", () => {
    // Redirect URIs and the client name are what the consent screen and the
    // redirect check depend on. Rewriting those would be a security change,
    // not a compatibility one.
    const input = doc(["authorization_code", "weird:grant"]);
    const { metadata } = narrowGrantTypes(input);
    const out = metadata as Record<string, unknown>;
    expect(out.client_id).toBe(input.client_id);
    expect(out.client_name).toBe(input.client_name);
    expect(out.redirect_uris).toEqual(input.redirect_uris);
    expect(out.response_types).toEqual(input.response_types);
  });

  it("refuses to rescue a client with nothing in common", () => {
    // An empty grant_types would register a client that cannot do anything,
    // and would hide a genuine incompatibility behind a successful-looking
    // registration. Let the provider reject it and say why.
    const input = doc(["urn:ietf:params:oauth:grant-type:jwt-bearer"]);
    const { changed, metadata } = narrowGrantTypes(input);
    expect(changed).toBe(false);
    expect(metadata).toBe(input);
  });

  it("ignores documents that are not shaped like metadata", () => {
    for (const junk of [null, undefined, 42, "text", { grant_types: "nope" }]) {
      expect(narrowGrantTypes(junk).changed).toBe(false);
    }
  });
});
