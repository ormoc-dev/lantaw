/* __BUILD_ID__ replaced at deploy by scripts/stamp-build.mjs */
const CACHE = "movie-v124";
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
