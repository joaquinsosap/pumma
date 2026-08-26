// Pinning the query reconstruction the consent page depends on.
//
// The bug this guards against was found by running a real authorization, not
// by reading the code: Better Auth lists the parameters its signature covers
// in a REPEATED `ba_param` key, Next parses repeated keys into an array, and
// the natural `typeof v === "string"` filter drops all of them. The rebuilt
// query still carried its `sig` and still looked complete, and every Allow
// click failed with `invalid_signature`.
import { describe, expect, it } from "vitest";
import { rebuildQuery } from "@/lib/mcp/query";

/** Parse the way Next does, so the fixtures are realistic. */
function parseLikeNext(qs: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of new URLSearchParams(qs)) {
    const cur = out[k];
    if (cur === undefined) out[k] = v;
    else if (Array.isArray(cur)) cur.push(v);
    else out[k] = [cur, v];
  }
  return out;
}

describe("rebuildQuery", () => {
  it("keeps every value of a repeated key", () => {
    const original =
      "client_id=abc&ba_param=ba_iat&ba_param=client_id&ba_param=scope&sig=xyz";
    const rebuilt = rebuildQuery(parseLikeNext(original));
    expect(rebuilt.match(/ba_param=/g)).toHaveLength(3);
    expect(new URLSearchParams(rebuilt).getAll("ba_param")).toEqual([
      "ba_iat",
      "client_id",
      "scope",
    ]);
  });

  it("round-trips a real signed authorization query unchanged", () => {
    // Copied from an actual /oauth2/authorize redirect.
    const original =
      "response_type=code&redirect_uri=http%3A%2F%2F127.0.0.1%3A9876%2Fcallback" +
      "&scope=openid+profile+pumma%3Aread&state=NTz3VIpww9duHttud2e3aw" +
      "&client_id=TuNRKZmYLgILQTXYfPmBOHYYoGGjGRZU&code_challenge_method=S256" +
      "&exp=1787757051&ba_iat=1787756451090&ba_param=ba_iat&ba_param=ba_param" +
      "&ba_param=client_id&ba_param=exp&ba_param=redirect_uri&ba_param=response_type" +
      "&ba_param=scope&ba_param=state&sig=ubo%2B9H6udegz4K8QvKHuhbWW2QyxUKutsArqOYBF38o%3D";

    const rebuilt = rebuildQuery(parseLikeNext(original));

    // Compare as parsed pairs: the signature is computed over a canonical
    // form, so what has to survive is every key and value, not the ordering.
    const pairs = (qs: string) =>
      [...new URLSearchParams(qs).entries()].sort().map(([k, v]) => `${k}=${v}`);
    expect(pairs(rebuilt)).toEqual(pairs(original));
  });

  it("preserves values that need encoding", () => {
    const original = "sig=ubo%2B9H6u%3D%3D&scope=a+b&uri=http%3A%2F%2Fx%2Fy";
    const parsed = new URLSearchParams(rebuildQuery(parseLikeNext(original)));
    // A `+` decoded as a space and re-encoded wrongly would change the
    // signature without changing how the string looks at a glance.
    expect(parsed.get("sig")).toBe("ubo+9H6u==");
    expect(parsed.get("scope")).toBe("a b");
    expect(parsed.get("uri")).toBe("http://x/y");
  });

  it("drops undefined without dropping empty strings", () => {
    expect(rebuildQuery({ a: undefined, b: "", c: "1" })).toBe("b=&c=1");
  });

  it("handles an empty query", () => {
    expect(rebuildQuery({})).toBe("");
  });
});
