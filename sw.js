/* __BUILD_ID__ replaced at deploy by scripts/stamp-build.mjs */
const CACHE = "movie-v146";
const BUILD_ID = "__BUILD_ID__";

function basePath() {
  const path = self.location.pathname.replace(/\/sw\.js$/, "");
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function sameOrigin(url) {
  try {
    return new URL(url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function isAppShell(request, url) {
  if (request.mode === "navigate") return true;
  if (request.destination === "document") return true;
  const p = url.pathname;
  return (
    p.endsWith(".html") ||
    p.endsWith(".js") ||
    p.endsWith(".css") ||
    p.endsWith(".webmanifest") ||
    p.endsWith("version.json")
  );
}

self.addEventListener("install", (event) => {
  const base = basePath();
  const assets = [
    `${base}/`,
    `${base}/index.html`,
    `${base}/src/styles/main.css`,
    `${base}/src/main.js`,
    `${base}/version.json`,
  ];
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(
          assets.map((url) =>
            cache.add(url).catch(() => {
              /* optional asset */
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/** Closed-app Web Push from Supabase Edge Function `send-push`. */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    try {
      payload = { body: event.data?.text?.() || "" };
    } catch {
      payload = {};
    }
  }

  const title = String(payload.title || "LANTAW");
  const base = basePath();
  const icon = `${base}/public/icons/LOGO.png`;
  const data = {
    url: payload.url || "#/friends",
    kind: payload.kind || "generic",
    ...(payload.data || {}),
  };

  event.waitUntil(
    self.registration.showNotification(title, {
      body: String(payload.body || "").slice(0, 180),
      icon,
      badge: icon,
      tag: payload.tag || data.kind || "lantaw",
      renotify: true,
      data,
      requireInteraction: Boolean(
        payload.requireInteraction || (payload.actions && payload.actions.length)
      ),
      actions: Array.isArray(payload.actions) ? payload.actions.slice(0, 2) : [],
      vibrate: data.kind === "call" ? [200, 100, 200, 100, 200] : [120],
    })
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of all) {
        client.postMessage({ type: "lantaw-push-resubscribe" });
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification?.data || {};
  const action = event.action || "";
  event.notification.close();

  event.waitUntil(
    (async () => {
      const base = basePath();
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      let client = all.find((c) => c.focus) || all[0] || null;

      if (client) {
        try {
          await client.focus();
        } catch {
          /* ignore */
        }
        client.postMessage({
          type: "lantaw-notify-action",
          action,
          data,
        });
        return;
      }

      let targetHash = "#/friends";
      if (data.chatId) {
        targetHash = `#/friends?chat=${encodeURIComponent(data.chatId)}`;
      } else if (data.url) {
        targetHash = String(data.url).startsWith("#")
          ? String(data.url)
          : `#${String(data.url).replace(/^\//, "")}`;
      }
      const openUrl = `${self.location.origin}${base || ""}/${targetHash}`.replace(
        /([^:]\/)\/+/g,
        "$1"
      );
      await self.clients.openWindow(openUrl);
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  if (!sameOrigin(request.url)) return;

  const url = new URL(request.url);

  // Never cache the service worker itself
  if (url.pathname.endsWith("/sw.js") || url.pathname.endsWith("sw.js")) {
    event.respondWith(fetch(request));
    return;
  }

  // App shell: network-first so deploys show up after SW takes over
  if (isAppShell(request, url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static media/icons: cache-first, refresh in background
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
