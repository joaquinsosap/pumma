/**
 * Installing PUMMA to the home screen or dock.
 *
 * Worth doing on every platform — a standalone window with no browser chrome
 * is most of what makes a web app feel like an app — but on iOS it is not
 * cosmetic. Apple allows web push ONLY for a site added to the Home Screen;
 * a page in a Safari tab cannot show a notification at all, ever. So on
 * iPhone this is the difference between reminders working and not existing.
 *
 * Two different mechanisms, because the platforms disagree:
 *
 *   - Chromium (Android, desktop) fires `beforeinstallprompt`, which can be
 *     captured and replayed later from a button. That gives a real, native
 *     install dialog at a moment we choose.
 *   - Safari on iOS has no API at all. The only route is Share → Add to Home
 *     Screen, done by hand, which means the honest thing to show is
 *     instructions rather than a button that cannot work.
 */

/** Already installed: running in its own window rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own flag, which predates the standard and is still what iOS
    // sets. Not in the DOM types, hence the cast.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac. The touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * iOS only allows this from Safari itself. Chrome and Firefox on iPhone are
 * Safari underneath but do not expose Add to Home Screen, so telling somebody
 * in Chrome to look for a Share menu that has no such item is worse than
 * saying nothing.
 */
export function isIosSafari(): boolean {
  if (!isIos()) return false;
  const ua = navigator.userAgent;
  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

/** The event Chromium fires. Not in the DOM lib, so it is spelled out here. */
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallRoute =
  /** A captured beforeinstallprompt is waiting; a button can fire it. */
  | "prompt"
  /** No API — show Share → Add to Home Screen. */
  | "ios-instructions"
  /** Already installed, or the browser gives us nothing to work with. */
  | "none";
