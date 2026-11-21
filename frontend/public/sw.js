// Keeps the app itself (pages, scripts, styles, fonts) available with no signal.
// Inspection data is NOT cached here. It lives in the browser database (IndexedDB).
const CACHE = "plumb-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["./", "favicon.svg"])).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page tells us which files it loaded, so the very first visit is already usable offline.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "cache-urls") {
    event.waitUntil(
      caches.open(CACHE).then((cache) => Promise.all(event.data.urls.map((url) => cache.add(url).catch(() => {}))))
    );
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // Always try for the newest page, fall back to the saved one when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("./", copy));
          return response;
        })
        .catch(() => caches.match("./", { ignoreVary: true }))
    );
    return;
  }

  // Scripts, styles and fonts have a fingerprint in their file name, so a saved copy is always right.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});
