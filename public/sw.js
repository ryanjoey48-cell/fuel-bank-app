const CACHE_NAME = "ees-operations-v4-private-data-network-only";
const APP_SHELL = [
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-icon.png",
  "/ees-logo.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  // API responses and employee/driver pages must never enter the offline cache.
  // Bypass previously cached responses too, including confidential HR files.
  if (url.pathname.startsWith("/api/") || ["/driver", "/drivers", "/hr", "/employees"].some(path => url.pathname === path || url.pathname.startsWith(path + "/")) || request.headers?.has("Authorization") || request.cache === "no-store") {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (url.pathname.startsWith("/_next/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === "opaque" || /no-store|private/i.test(response.headers.get("Cache-Control") || "")) {
          return response;
        }

        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
        return response;
      });
    })
  );
});

// Only server-created, same-origin event links are accepted from push payloads.
self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const href = typeof payload.href === "string" && /^\/(?!\/)[a-zA-Z0-9/_?=&%-]*$/.test(payload.href)
    ? payload.href : "/fleet-events";
  const title = typeof payload.title === "string" ? payload.title.slice(0, 120) : "EES Fleet";
  const body = typeof payload.body === "string" ? payload.body.slice(0, 240) : "Open EES to review an update.";
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: "/icon-192.png", badge: "/favicon-32.png",
    tag: typeof payload.tag === "string" ? payload.tag.slice(0, 160) : undefined,
    data: { href }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data?.href || "/fleet-events";
  event.waitUntil((async () => {
    const url = new URL(href, self.location.origin);
    if (url.origin !== self.location.origin) return;
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(url.href);
      await existing.focus();
    } else {
      await self.clients.openWindow(url.href);
    }
  })());
});
