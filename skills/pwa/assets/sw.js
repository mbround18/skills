// Framework-agnostic service worker template. Plain JS, no build step, no
// dependencies. Ship it at the root of the app's scope (e.g. /sw.js) with
// `Cache-Control: no-cache` so browsers always check for a new version.
//
// Strategy per request type:
//   navigations (HTML)      network first → cached page → offline page
//   app shell / hashed assets cache first, refreshed in the background
//   API and everything else network only (never cached)
//
// Bump VERSION on every deploy that changes SHELL; the activate handler
// deletes caches from older versions.

const VERSION = "v1";
const CACHE = `app-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const SHELL = ["/", OFFLINE_URL, "/manifest.webmanifest", "/icons/icon-192.png"];
// Paths that must always come from the network (APIs, auth, analytics).
const NETWORK_ONLY = [/^\/api\//, /^\/auth\//];
// Static assets worth caching as they are requested. Build tools that hash
// file names (app.3f9a1c.js) make these safe to serve from cache forever.
const STATIC = /\.(?:js|mjs|css|woff2?|png|jpe?g|webp|avif|svg|ico)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("app-") && n !== CACHE).map((n) => caches.delete(n)));
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

// The page asks the waiting worker to take over once the user agrees to update.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never cache writes
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // leave third parties alone
  if (NETWORK_ONLY.some((re) => re.test(url.pathname))) return;

  if (request.mode === "navigate") event.respondWith(networkFirst(event));
  else if (STATIC.test(url.pathname) || SHELL.includes(url.pathname)) event.respondWith(staleWhileRevalidate(event));
});

async function networkFirst(event) {
  const cache = await caches.open(CACHE);
  try {
    const response = (await event.preloadResponse) ?? (await fetch(event.request));
    if (response.ok) cache.put(event.request, response.clone());
    return response;
  } catch {
    return (await cache.match(event.request)) ?? (await cache.match(OFFLINE_URL)) ?? Response.error();
  }
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then((response) => {
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    })
    .catch(() => cached ?? Response.error());
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return refresh;
}
