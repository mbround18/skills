# Service worker: caching, lifecycle, background work

The service worker is a script the browser runs on its own thread, separate
from your pages. It can intercept every request its pages make (`fetch`
event), keep responses in the Cache API, and be woken for background events
(sync, push) while no page is open. It cannot touch the DOM; it talks to
pages by `postMessage`.

## Lifecycle, and the traps in it

1. **Register** from the page: `navigator.serviceWorker.register("/sw.js")`.
   The script's URL sets the maximum scope: `/sw.js` can control `/`,
   `/app/sw.js` only `/app/…`. Put it at the root of what it should control.
2. **install** fires once per new script version — on the first *visit*, not
   when the user installs the PWA. Precache the shell here inside
   `event.waitUntil()`; if any precache request fails, the install fails.
3. **waiting** — a new version waits until no page uses the old one. Tabs
   and installed windows can live for days, so updates can stall unless you
   prompt (see `assets/register-sw.js`).
4. **activate** — the old worker is gone; delete old caches here.
5. **fetch** — call `event.respondWith()` to answer; don't call it and the
   request goes to the network as if no worker existed.

Browsers check for a new `sw.js` on navigation and at least every 24 h.
Serve it with `Cache-Control: no-cache` (never long-lived), and never
rename it per build, or old clients keep the old one forever.

The browser may stop an idle worker at any time and restart it for the next
event: keep no state in global variables that you can't rebuild.

## Choosing a strategy per resource

A cache trades **freshness** for **offline operation** and **speed**. Pick
per resource, not per app.

| Resource | Strategy | Why |
|---|---|---|
| App shell, hashed JS/CSS, fonts, icons | **Cache first** (precache) | Never changes within a version; must be instant and offline |
| Images, avatars, non-critical JSON | **Stale-while-revalidate** (cache first + refresh) | Fast; fresh enough after the next request |
| HTML navigations, messages, feeds | **Network first**, fall back to cache, then offline page | Fresh when online, something useful when not |
| Prices, stock, balances, auth, POST/PUT/DELETE | **Network only** | Stale is worse than nothing; writes are never cached |

Rules that keep any strategy correct:

- **Clone before caching** — a `Response` body can be read once:
  `cache.put(req, res.clone()); return res;`
- **Only cache `res.ok` responses** (and same-origin, unless you mean to
  store opaque cross-origin responses, which hide errors and cost quota).
- **Precached still falls back to network** — users and browsers can clear
  caches; a cache miss must not break the app.
- **Version cache names** (`app-v42`) and delete the rest on activate.
- **Navigation preload** — in network-first for HTML, enable
  `registration.navigationPreload` so the request starts while the worker
  boots.
- **Single-page apps** — navigations to client-side routes should be
  answered with the cached shell (`/index.html`) when offline, so deep links
  open offline.

## When to cache

- At **install** — the shell (precache).
- In **fetch** — on the way through (runtime caching).
- On **user request** — "Save for offline" (e.g. tracks, articles); large
  downloads via Background Fetch where available.
- **Periodically** — Periodic Background Sync to refresh content while closed.

## Background work (Chromium-led; always feature-detect)

| Need | API | Constraints |
|---|---|---|
| Send queued writes when back online | Background Sync (`registration.sync.register(tag)` → `sync` event) | Registered while a page is open; limited retries; the handler must finish quickly (Chrome stops a worker idle 30 s or with a `waitUntil` promise over ~5 min) and restarts from the beginning |
| Long downloads that outlive the page | Background Fetch | Needs permission; browser shows progress UI; store results before the handler returns |
| Fresh content at launch | Periodic Background Sync (`periodicSync.register(tag, {minInterval})`) | Needs permission; mostly for installed apps; frequency follows engagement; unregister when the user turns it off |
| Server-initiated alerts | Push + Notifications | Needs permission; every push must show a notification (no silent push); VAPID keys; server encrypts via a push service |

Always pair Background Sync with a fallback (retry on `online` or next
launch), since only Chromium implements it.

## Tooling, if a build step already exists

The template in `assets/sw.js` needs no build. If the project already uses a
bundler, a generator (e.g. Workbox, or the framework's PWA plugin) can
inject the precache list with hashed file names, which removes the manual
`SHELL` list and `VERSION` bump. Either way, the strategies above are what
to configure, and `scripts/audit.mjs` checks the generated worker.
