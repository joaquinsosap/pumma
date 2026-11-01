import { afterEach, describe, expect, it, vi } from "vitest";
import { isLostConnection, serverAnswers } from "@/lib/lost-connection";

describe("serverAnswers", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stub = (onLine: boolean, fetchImpl: () => Promise<Response>) => {
    const fetchSpy = vi.fn(fetchImpl);
    vi.stubGlobal("navigator", { onLine });
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  };

  it("doesn't even ask when the browser knows it's offline", async () => {
    const fetchSpy = stub(false, async () => new Response("ok"));
    expect(await serverAnswers()).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is true when the health check answers, and skips every cache", async () => {
    const fetchSpy = stub(true, async () => new Response("ok"));
    expect(await serverAnswers()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith("/api/health", { cache: "no-store" });
  });

  it("is false during a deploy, when a proxy answers instead of the app", async () => {
    stub(true, async () => new Response("bad gateway", { status: 502 }));
    expect(await serverAnswers()).toBe(false);
  });

  it("is false when the wifi says connected and nothing answers", async () => {
    stub(true, async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await serverAnswers()).toBe(false);
  });
});

describe("isLostConnection", () => {
  it.each([
    "Failed to fetch",
    "Load failed",
    "NetworkError when attempting to fetch resource.",
  ])("knows what a browser throws: %s", (message) => {
    expect(isLostConnection(new TypeError(message))).toBe(true);
  });

  it("doesn't take a real bug for a dropped connection", () => {
    expect(
      isLostConnection(new TypeError("Cannot read properties of undefined")),
    ).toBe(false);
  });

  it("wants the browser's error type, not just the words", () => {
    expect(isLostConnection(new Error("Failed to fetch"))).toBe(false);
    expect(isLostConnection("Failed to fetch")).toBe(false);
    expect(isLostConnection(null)).toBe(false);
  });
});
