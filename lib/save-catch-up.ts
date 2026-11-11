// Next throws away a save's page when the address is written while the save runs, and a refresh's page too. This notices and asks for the page again.
// It also holds a page that got no answer until the server is back: Next would leave for the browser's error screen, and unsaved text goes with it.

import {
  isLostConnection,
  isProxyAnswer,
  noAnswer,
  serverAnswered,
  serverAnswers,
  whenServerAnswers,
} from "@/lib/lost-connection";

const ACTION_HEADER = "next-action";
const PAGE_HEADER = "rsc";
const PREFETCH_HEADER = "next-router-prefetch";

let saves = 0;
let movedDuringSave = false;
let urlWrites = 0;
let refresh: (() => void) | null = null;
let watching = false;

function wroteUrl() {
  urlWrites++;
  if (saves > 0) movedDuringSave = true;
}

/** Asks for the page if a save lost its own. A save calls this itself to stay inside its transition, so what it shows optimistically holds until the page comes. */
export function catchUpNow() {
  if (!movedDuringSave) return;
  movedDuringSave = false;
  refresh?.();
}

function saveEnded(answered: boolean) {
  if (answered) serverAnswered();
  saves--;
  if (saves > 0) return;
  if (answered) catchUpNow();
  // Asking for a page with no connection would wait for it, with every later save behind it.
  else movedDuringSave = false;
}

/** A save is never sent twice: with no answer nobody knows whether it landed. */
function watchedSave(send: () => Promise<Response>): Promise<Response> {
  saves++;
  return send().then(
    (res) => {
      if (isProxyAnswer(res.status)) {
        saveEnded(false);
        throw noAnswer();
      }
      // The page comes in the body, so the save isn't over until the body is.
      void res
        .clone()
        .arrayBuffer()
        .then(
          () => saveEnded(res.ok),
          () => saveEnded(false),
        );
      return res;
    },
    (err) => {
      saveEnded(false);
      throw err;
    },
  );
}

/**
 * A page asked for with no connection, or during a deploy, comes when the
 * server is back. Asking again is safe: a page changes nothing.
 *
 * Only while the server really is away. A redirect to another site fails the
 * same way as a lost connection, so when the server answers and the page
 * still does not, it is asked once more (a blip) and then handed to Next.
 */
async function watchedPage(ask: () => Promise<Response>): Promise<Response> {
  let failedWhileUp = false;
  for (;;) {
    let proxy: Response | null = null;
    let lost: unknown = null;
    try {
      const res = await ask();
      if (!isProxyAnswer(res.status)) {
        if (res.ok) serverAnswered();
        return res;
      }
      proxy = res;
    } catch (err) {
      // An abort, or anything that isn't the connection, is Next's to handle.
      if (!isLostConnection(err)) throw err;
      lost = err;
    }
    if (await serverAnswers()) {
      if (failedWhileUp) {
        if (proxy) return proxy;
        throw lost;
      }
      failedWhileUp = true;
      continue;
    }
    failedWhileUp = false;
    await whenServerAnswers();
  }
}

function watchFetch() {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (init?.method === "POST" && headers.has(ACTION_HEADER)) {
      return watchedSave(() => realFetch(input, init));
    }
    // A prefetch is a guess, and Next drops one that fails.
    if (headers.has(PAGE_HEADER) && !headers.has(PREFETCH_HEADER)) {
      return watchedPage(() => realFetch(input, init));
    }
    return realFetch(input, init);
  };
}

function watchHistory(method: "pushState" | "replaceState") {
  const write = window.history[method].bind(window.history);
  window.history[method] = (data, unused, url) => {
    // Next's own calls carry these and throw nothing away.
    if (url && !data?.__NA && !data?._N) wroteUrl();
    write(data, unused, url);
  };
}

/** Call once Next has patched history: its patch adds __NA to every call, so going under it would hide them all. */
export function watchSaves(onSavePageLost: () => void) {
  refresh = onSavePageLost;
  if (watching) return;
  watching = true;
  watchFetch();
  watchHistory("pushState");
  watchHistory("replaceState");
  window.addEventListener("popstate", wroteUrl);
}

/** Changes whenever the address is written or navigated. */
export function urlMark(): string {
  return `${urlWrites} ${window.location.href}`;
}
