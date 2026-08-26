/* PUMMA service worker: notifications only.
 *
 * Deliberately not a caching worker. Offline support would mean deciding what
 * a stale task list is worth, and this file exists for one job: receive a
 * push, show it, and put the person in front of the thing it was about.
 *
 * No secrets live here. It is a public file by nature; everything it does is
 * either display or a same-origin fetch carrying the user's own cookie.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

/* A fetch handler that does nothing. Deliberately.
 *
 * This worker caches nothing and is not meant to — but Chromium will not
 * treat a site as installable unless its service worker handles `fetch`, and
 * with no handler there is no `beforeinstallprompt`, so the Install button
 * never appears and PUMMA can never reach a home screen. On iOS that would
 * also mean notifications could never work at all, since Apple gates push
 * behind being installed.
 *
 * So the event is handled and the request is left alone: no respondWith means
 * it falls through to the network exactly as it would have. Real caching here
 * would mean deciding what a stale task list is worth, which is a much bigger
 * question than "let people install this".
 */
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "PUMMA";
  const actions = [];
  // Join first: it is the only reason somebody taps a meeting reminder in a
  // hurry. iOS renders no actions at all, which is why the notification body
  // still opens the app to a sheet carrying the same button.
  if (data.joinUrl) actions.push({ action: "join", title: "Join" });
  if (data.kind === "task") actions.push({ action: "done", title: "Done" });
  actions.push({ action: "snooze", title: "Snooze 10m" });

  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      // Same tag as the notification's id, so a re-send replaces the banner
      // instead of stacking a second copy of the same reminder.
      tag: data.id || "pumma",
      renotify: false,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: {
        id: data.id || "",
        url: data.url || "/",
        joinUrl: data.joinUrl || "",
      },
      actions,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const d = event.notification.data || {};
  event.notification.close();

  if (event.action === "join" && d.joinUrl) {
    // Straight to the call. Routing this through the app would put a page
    // load between somebody and a meeting they are already late for.
    event.waitUntil(self.clients.openWindow(d.joinUrl));
    return;
  }

  if (event.action === "snooze" || event.action === "done") {
    const path =
      event.action === "snooze"
        ? `/api/notifications/${encodeURIComponent(d.id)}/snooze`
        : `/api/notifications/${encodeURIComponent(d.id)}/done`;
    // Same-origin, so the session cookie rides along and the route can check
    // the notification actually belongs to whoever is signed in here.
    event.waitUntil(fetch(path, { method: "POST", credentials: "include" }));
    return;
  }

  // The plain click. Focus a tab that already exists and tell it WHICH
  // notification this was, so it opens that notification's own sheet rather
  // than dumping somebody on a page and leaving them to find the thing.
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const mine = all.find((c) => new URL(c.url).origin === self.location.origin);
      if (mine) {
        await mine.focus();
        mine.postMessage({ type: "pumma-notification", id: d.id });
        return;
      }
      // Nothing open — the browser may have been closed entirely. The id goes
      // in the URL so the app can open the same sheet on a cold start.
      const url = d.id
        ? `/?n=${encodeURIComponent(d.id)}`
        : d.url || "/";
      await self.clients.openWindow(url);
    })(),
  );
});

/* A push service can rotate an endpoint on its own. Without this the device
   silently stops receiving anything and nobody finds out until they wonder
   why a meeting went unannounced. */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const sub = await self.registration.pushManager.subscribe(
          event.oldSubscription?.options ?? { userVisibleOnly: true },
        );
        await fetch("/api/notifications/subscribe", {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
      } catch {
        /* nothing useful to do here; the app re-subscribes on next open */
      }
    })(),
  );
});
