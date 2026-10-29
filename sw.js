const CACHE = "movie-v103";

function basePath() {
  const path = self.location.pathname.replace(/\/sw\.js$/, "");
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

self.addEventListener("install", (event) => {
  const base = basePath();
  const assets = [
    `${base}/`,
    `${base}/index.html`,
    `${base}/src/styles/main.css`,
    `${base}/src/main.js`,
  ];
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(assets)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
