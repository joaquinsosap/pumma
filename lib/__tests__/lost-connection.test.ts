import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isLostConnection,
  isProxyAnswer,
  pagePutBack,
  recoveryFor,
  serverAnswered,
  serverAnswers,
  whenServerAnswers,
} from "@/lib/lost-connection";

// The notice is drawn by the toaster, which needs a browser.
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() },
}));

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
    expect(fetchSpy).toHaveBeenCalledWith("/api/health?ready=1", {
      cache: "no-store",
    });
  });

  it("is false during a deploy, when a proxy answers instead of the app", async () => {
    stub(true, async () => new Response("bad gateway", { status: 502 }));
    expect(await serverAnswers()).toBe(false);
  });

  it("is false with the database down, when a page would be an error screen", async () => {
    stub(true, async () => new Response("degraded", { status: 503 }));
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
    // Chrome, when the answer stops part way through.
    "network error",
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

describe("isProxyAnswer", () => {
  it.each([502, 503, 504])("takes %i for the app being away", (status) => {
    expect(isProxyAnswer(status)).toBe(true);
  });

  it.each([200, 404, 500])("takes %i for the app's own answer", (status) => {
    expect(isProxyAnswer(status)).toBe(false);
  });
});

describe("what an error screen does about a lost connection", () => {
  it("leaves a real error on the screen", () => {
    expect(recoveryFor(new Error("boom"))).toBe("none");
  });

  const lost = new TypeError("Failed to fetch");

  it("puts the page straight back the first time: a save failed, the page is fine", () => {
    serverAnswered();
    expect(recoveryFor(lost)).toBe("now");
  });

  it("waits the second time, however long after: that page can't load with no connection", () => {
    serverAnswered();
    pagePutBack();
    expect(recoveryFor(lost)).toBe("waiting");
    expect(recoveryFor(lost)).toBe("waiting");
  });

  it("puts the page straight back again once anything was answered", () => {
    pagePutBack();
    serverAnswered();
    expect(recoveryFor(lost)).toBe("now");
  });
});

describe("whenServerAnswers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks until the server answers, with one poll however many wait", async () => {
    vi.useFakeTimers();
    let up = false;
    const fetchSpy = vi.fn(async () => {
      if (!up) throw new TypeError("Failed to fetch");
      return new Response("ok");
    });
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("window", { setTimeout });

    let done = 0;
    const first = whenServerAnswers();
    expect(whenServerAnswers()).toBe(first);
    void first.then(() => done++);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(done).toBe(0);

    up = true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(done).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    // The next loss starts a wait of its own.
    expect(whenServerAnswers()).not.toBe(first);
  });
});
