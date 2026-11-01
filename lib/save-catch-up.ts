// Next throws away a save's page when the address is written while the save runs, and a refresh's page too. This notices and asks for the page again.

const ACTION_HEADER = "next-action";

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
  saves--;
  if (saves > 0) return;
  if (answered) catchUpNow();
  // Asking for a page with no connection makes Next leave this one.
  else movedDuringSave = false;
}

function watchFetch() {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const isSave =
      init?.method === "POST" && new Headers(init.headers).has(ACTION_HEADER);
    if (!isSave) return realFetch(input, init);
    saves++;
    return realFetch(input, init).then(
      (res) => {
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
