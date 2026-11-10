// Which requests a session-backed route treats as its own site's.
import { describe, expect, it } from "vitest";
import { sameSite } from "@/lib/same-site";

const req = (headers: Record<string, string>) =>
  new Request("https://app.example.com/api/x", { method: "POST", headers });

describe("sameSite", () => {
  it("takes a request from the site's own pages", () => {
    expect(sameSite(req({ origin: "https://app.example.com", host: "app.example.com" }))).toBe(true);
    expect(sameSite(req({ origin: "http://localhost:3001", host: "localhost:3001" }))).toBe(true);
  });

  it("takes the host a proxy says it was reached by", () => {
    expect(
      sameSite(
        req({ origin: "https://app.example.com", host: "pumma:3000", "x-forwarded-host": "app.example.com" }),
      ),
    ).toBe(true);
  });

  it.each([
    ["another site", "https://evil.example.org"],
    ["a sibling address under the same domain", "https://other.example.com"],
    ["a look-alike", "https://app.example.com.evil.example.org"],
    ["another port", "https://app.example.com:8443"],
    ["something that is no address", "null"],
  ])("refuses %s", (_what, origin) => {
    expect(sameSite(req({ origin, host: "app.example.com" }))).toBe(false);
  });

  it("lets through a request that names no origin, which no other site's page can send with the cookie", () => {
    expect(sameSite(req({ host: "app.example.com" }))).toBe(true);
  });

  it("is not fooled by letter case", () => {
    expect(sameSite(req({ origin: "https://APP.example.com", host: "App.Example.com" }))).toBe(true);
  });
});
