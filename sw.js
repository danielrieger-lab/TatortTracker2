const CACHE_NAME = "tatorttracker2-v18";
const ASSETS = [
  "./", "./index.html", "./manifest.webmanifest", "./src/app.js", "./src/styles.css",
  "./data/tatort-episodes.json", "./assets/fonts/futura-bold-webfont.woff2", "./assets/fonts/futurabt-light-webfont.woff2",
  "./assets/icons/episode.svg", "./assets/icons/fallqualität.svg", "./assets/icons/team.svg",
  "./assets/icons/inszenierung.svg", "./assets/icons/spannung.svg", "./assets/icons/gruselig.svg"
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
  const isAppShell = ["document", "script", "style"].includes(event.request.destination);
  if (isAppShell) {
    event.respondWith(fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
