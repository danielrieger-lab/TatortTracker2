const CACHE_NAME = "tatorttracker2-v2";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest", "./src/app.js", "./src/styles.css",
  "./data/tatort-episodes.json", "./assets/fonts/futura-bold-webfont.woff2", "./assets/fonts/futurabt-light-webfont.woff2"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
