// A real Response and a stand-in window: the watcher only touches fetch, history, popstate and the address.
import { ACTION_HEADER } from "next/dist/client/components/app-router-headers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Module = typeof import("@/lib/save-catch-up");

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A response whose body stays open until `end`, because the page comes in the body. */
function openResponse(status = 200) {
  let end = () => {};
  let fail = () => {};
  const body = new ReadableStream({
    start(controller) {
      end = () => controller.close();
      fail = () => controller.error(new Error("connection dropped"));
    },
  });
  return { res: new Response(body, { status }), end: () => end(), fail: () => fail() };
}

describe("the save watcher", () => {
  let mod: Module;
  let refresh: ReturnType<typeof vi.fn<() => void>>;
  let answers: Array<(res: Response) => void>;
  let losses: Array<(err: Error) => void>;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let realPush: ReturnType<typeof vi.fn>;
  let realReplace: ReturnType<typeof vi.fn>;
  let onPopState: () => void;
  let win: {
    fetch: typeof fetch;
    history: Pick<History, "pushState" | "replaceState">;
    addEventListener: (type: string, fn: () => void) => void;
    location: { href: string };
  };

  beforeEach(async () => {
    vi.resetModules();
    answers = [];
    losses = [];
    fetchSpy = vi.fn(
      () =>
        new Promise<Response>((resolve, reject) => {
          answers.push(resolve);
          losses.push(reject);
        }),
    );
    realPush = vi.fn();
    realReplace = vi.fn();
    win = {
      fetch: fetchSpy as unknown as typeof fetch,
      history: {
        pushState: realPush as unknown as History["pushState"],
        replaceState: realReplace as unknown as History["replaceState"],
      },
      addEventListener: (type, fn) => {
        if (type === "popstate") onPopState = fn;
      },
      location: { href: "http://x/tasks" },
    };
    vi.stubGlobal("window", win);
    mod = await import("@/lib/save-catch-up");
    refresh = vi.fn<() => void>();
    mod.watchSaves(refresh);
  });

  afterEach(() => vi.unstubAllGlobals());

  const save = () =>
    win.fetch("/tasks", { method: "POST", headers: { [ACTION_HEADER]: "abc" } });
  const moveAddress = (url = "/tasks?task=1") =>
    win.history.replaceState(null, "", url);

  async function answerLast(status = 200) {
    const open = openResponse(status);
    answers[answers.length - 1](open.res);
    await tick();
    return open;
  }

  it("asks for the page when the address is written during a save, once the body is in", async () => {
    void save();
    moveAddress();
    const { end } = await answerLast();
    expect(refresh).not.toHaveBeenCalled();
    end();
    await tick();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("catches an address write while the page is still coming", async () => {
    void save();
    const { end } = await answerLast();
    moveAddress();
    end();
    await tick();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("asks for nothing when the address stayed put", async () => {
    void save();
    const { end } = await answerLast();
    end();
    await tick();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks for nothing when the address moved with no save out", async () => {
    moveAddress();
    void save();
    const { end } = await answerLast();
    end();
    await tick();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("catches an address that came back to where it started", async () => {
    void save();
    moveAddress("/tasks?task=1");
    moveAddress("/tasks");
    const { end } = await answerLast();
    end();
    await tick();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("ignores Next's own history calls, which throw nothing away", async () => {
    void save();
    win.history.replaceState({ __NA: true }, "", "/tasks");
    win.history.pushState({ _N: true }, "", "/tasks");
    win.history.replaceState(null, "");
    const { end } = await answerLast();
    end();
    await tick();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("counts back and forward", async () => {
    void save();
    onPopState();
    const { end } = await answerLast();
    end();
    await tick();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("counts a pushed address as well as a replaced one", async () => {
    void save();
    win.history.pushState(null, "", "/notes");
    const { end } = await answerLast();
    end();
    await tick();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("still makes the real write, whoever asked", () => {
    moveAddress("/tasks?task=9");
    expect(realReplace).toHaveBeenCalledExactlyOnceWith(null, "", "/tasks?task=9");
    win.history.pushState({ __NA: true }, "", "/notes");
    expect(realPush).toHaveBeenCalledExactlyOnceWith({ __NA: true }, "", "/notes");
  });

  it("waits for the last of two saves", async () => {
    void save();
    void save();
    moveAddress();
    const first = openResponse();
    answers[0](first.res);
    await tick();
    first.end();
    await tick();
    expect(refresh).not.toHaveBeenCalled();
    const second = openResponse();
    answers[1](second.res);
    await tick();
    second.end();
    await tick();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("asks for nothing after a lost save, since a refresh with no connection leaves the page", async () => {
    const lost = save();
    moveAddress();
    losses[0](new TypeError("Failed to fetch"));
    await expect(lost).rejects.toThrow("Failed to fetch");
    expect(refresh).not.toHaveBeenCalled();

    void save();
    const { end } = await answerLast();
    end();
    await tick();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks for nothing after a server error, which a refresh would turn into a full reload", async () => {
    void save();
    moveAddress();
    const { end } = await answerLast(500);
    end();
    await tick();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks for nothing when the body breaks off", async () => {
    void save();
    moveAddress();
    const { fail } = await answerLast();
    fail();
    await tick();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("hands back the response with its body unread, for Next", async () => {
    const out = save();
    const open = openResponse();
    answers[0](open.res);
    const res = await out;
    open.end();
    await tick();
    expect(res.bodyUsed).toBe(false);
    await expect(res.text()).resolves.toBe("");
  });

  it("leaves every other request alone", async () => {
    moveAddress();
    void win.fetch("/x");
    void win.fetch("/x", { method: "POST" });
    void win.fetch("/x", { headers: { [ACTION_HEADER]: "abc" } });
    moveAddress();
    answers.forEach((answer) => answer(new Response("")));
    await tick();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks once when the save got there first", async () => {
    void save();
    moveAddress();
    const { end } = await answerLast();
    mod.catchUpNow();
    expect(refresh).toHaveBeenCalledOnce();
    end();
    await tick();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("asks again for a later save that also lost its page", async () => {
    void save();
    moveAddress();
    const first = await answerLast();
    first.end();
    await tick();

    void save();
    moveAddress("/tasks?task=2");
    const second = await answerLast();
    second.end();
    await tick();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("goes on only once however often it is called", () => {
    const patched = win.history.replaceState;
    mod.watchSaves(refresh);
    expect(win.history.replaceState).toBe(patched);
  });

  it("uses the latest handler it was given", async () => {
    const later = vi.fn<() => void>();
    mod.watchSaves(later);
    void save();
    moveAddress();
    const { end } = await answerLast();
    end();
    await tick();
    expect(later).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });

  describe("the mark", () => {
    it("changes on a write, even back to the same address", () => {
      const before = mod.urlMark();
      moveAddress("/tasks");
      expect(mod.urlMark()).not.toBe(before);
    });

    it("changes on a navigation, which writes nothing through us", () => {
      const before = mod.urlMark();
      win.location.href = "http://x/notes";
      expect(mod.urlMark()).not.toBe(before);
    });

    it("stays put otherwise", () => {
      const before = mod.urlMark();
      win.history.replaceState({ __NA: true }, "", "/tasks");
      expect(mod.urlMark()).toBe(before);
    });
  });
});
