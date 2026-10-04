const CACHE_NAME = "sheshield-cache-v4";
const urlsToCache = [
  "/main_program/index.html",
  "/main_program/style.css",
  "/main_program/app.js",
  "/main_program/firebase-config.js",
  "/manifest.json",
  "/icon_of_webApp/icon-192.png.png",
  "/icon_of_webApp/icon-512.png.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames.filter(function (cacheName) {
          return cacheName !== CACHE_NAME;
        }).map(function (cacheName) {
          return caches.delete(cacheName);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (requestUrl.pathname.indexOf("/__/") >= 0) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(function (response) {
          return response;
        })
        .catch(function () {
          return caches.match("/main_program/index.html");
        })
    );
    return;
  }

  if (event.request.destination === "document" || event.request.destination === "script" || event.request.destination === "style" || event.request.destination === "image") {
    event.respondWith(
      caches.match(event.request).then(function (cachedResponse) {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request)
          .then(function (response) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, copy);
            });
            return response;
          })
          .catch(function () {
            return caches.match("/main_program/index.html");
          });
      })
    );
  }
});