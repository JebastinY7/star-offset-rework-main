/* Service worker: shows a system notification when the server sends a Web Push, even if the portal is closed.
   Served from the site root as /sw.js (this file lives in public/). It does no caching and never touches page requests. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Safari / WebKit counts a push that shows no notification as abuse and cancels the subscription,
// so there we always show one. Chrome / Edge / Firefox are fine with skipping it when the page is on screen.
const isWebKit = /AppleWebKit/.test(self.navigator.userAgent) && !/Chrome\/|Chromium\/|Android|Firefox\//.test(self.navigator.userAgent);

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data ? event.data.text() : "" }; }

  event.waitUntil((async () => {
    if (!isWebKit) {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Only skip when the person is really looking at the portal (tab visible AND window focused).
      // A visible but unfocused window (another app in front) still gets the system notification.
      if (wins.some((w) => w.visibilityState === "visible" && w.focused)) return; // the open page already shows its own toast
    }
    await self.registration.showNotification(d.title || "Star Offset Printing", {
      body: d.body || "",
      icon: "/images/favicon.png",
      badge: "/images/favicon.png",
      tag: d.tag || undefined,       // same tag = the newer notification replaces the older one
      renotify: !!d.tag,
      data: { link: d.link || "/" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (win) {
      await win.focus();
      win.postMessage({ type: "push-open", link }); // PushPrompt.jsx moves the open app to that page
      return;
    }
    await self.clients.openWindow(new URL(link, self.location.origin).href);
  })());
});
