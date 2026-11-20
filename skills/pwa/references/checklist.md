# PWA checklist: minimum → compatible → robust

Work top to bottom. Each tier assumes the one before it. Items marked
**(audit)** are checked by `scripts/audit.mjs`; the rest need a browser, a
device, or a human. Each item says *why*, so you can judge an exception.

---

## Tier 1 — Minimum: installable, and never a dead page

The bar for "this is a PWA": browsers offer to install it, and launching it
offline shows your UI rather than the browser's error page.

- [ ] **Served over HTTPS** (`localhost` / `127.0.0.1` count for development;
  `file://` does not). Service workers and install both refuse insecure
  origins. Check redirects too: `http://` → `https://`, no mixed content.
- [ ] **Every page links the manifest** — `<link rel="manifest" href="…">` in
  the `<head>` of *every* HTML response, including server-rendered routes,
  error pages and pages a router renders on the server. **(audit)**
- [ ] **Manifest is valid JSON** and served (ideally as
  `application/manifest+json`). **(audit)**
- [ ] **`name` and/or `short_name`.** `short_name` ≤ ~12 characters, or the
  home screen will truncate it. **(audit)**
- [ ] **Icons at 192×192 and 512×512** with purpose `any` (or no purpose),
  PNG, and the files really are those sizes. **(audit)**
- [ ] **`start_url`** set, and it loads while offline. **(audit)**
- [ ] **`display`** is `standalone`, `fullscreen` or `minimal-ui` (or
  `display_override` lists one). `browser` is not an app. **(audit)**
- [ ] **`prefer_related_applications`** absent or `false` — `true` makes
  Chromium refuse install. **(audit)**
- [ ] **Responsive viewport** — `<meta name="viewport"
  content="width=device-width, initial-scale=1">` on every page. **(audit)**
- [ ] **A service worker is registered** from the page, its script is at
  (or above) the path it should control, and it is served with
  `Cache-Control: no-cache` so updates are seen. **(audit)**
- [ ] **The worker handles `fetch`** and **serves an offline fallback page**
  for failed navigations. The service worker is optional for Chromium's
  install criteria, but without it the installed app opens to a browser
  error offline — not acceptable for an app. **(audit)**
- [ ] **Install works** — Chrome/Edge show the install icon in the address
  bar; DevTools → Application → Manifest shows no errors.

## Tier 2 — Compatible: right on every platform that installs it

Install and launch behave correctly across Chromium (desktop and Android),
Safari (iOS/iPadOS 16.4+, macOS 14+ "Add to Dock"), Samsung Internet, and
degrade gracefully in Firefox (desktop Firefox doesn't install from a
manifest; it just gets a fast, offline-capable website).

- [ ] **Explicit `id`** so the installed app keeps its identity even if
  `start_url` changes later. Changing `id` after launch creates a *different*
  app for existing users — pick it once. **(audit)**
- [ ] **`scope` set and `start_url` inside it.** Navigations outside scope
  open with browser UI; with several frontends on one origin, scopes must not
  overlap. **(audit)**
- [ ] **Maskable icon** — a separate icon with `purpose: "maskable"`, artwork
  inside the central 80% (circle of radius 40%), full-bleed background.
  Without it Android shrinks your icon onto a white plate. Never mark the
  regular icon `"any maskable"`. **(audit)**
- [ ] **`apple-touch-icon`** (180×180, opaque, square corners) in the
  `<head>`: iOS/iPadOS uses it for the home screen. **(audit)**
- [ ] **`theme_color` + `background_color`** in the manifest, and
  `<meta name="theme-color">` in pages (one per `prefers-color-scheme` if the
  app has a dark theme). `background_color` should equal the page's CSS
  background so the splash → first paint transition doesn't flash. **(audit)**
- [ ] **`description` and `screenshots`** (at least one `form_factor: "wide"`
  and one `"narrow"`) — Chromium shows a richer, store-like install dialog
  with them. **(audit)**
- [ ] **`lang` on `<html>` and a real `<title>` on every page** — app
  switchers, screen readers and the install dialog use them. **(audit)**
- [ ] **Standalone mode has its own navigation.** No browser back button in
  `standalone`: every screen needs an in-app way back (or use `minimal-ui`).
  Test with `@media (display-mode: standalone)`.
- [ ] **Safe areas** — `viewport-fit=cover` plus `env(safe-area-inset-*)`
  padding if you draw edge to edge (notches, home indicators).
- [ ] **No install-only dead ends.** `beforeinstallprompt` is Chromium-only:
  hide any custom "Install" button until it fires; on iOS, show a short "Share
  → Add to Home Screen" hint instead (only in Safari, only when not already
  `standalone`).
- [ ] **Deep links work cold.** Any in-scope URL loads directly (server
  rewrites for client-side routes), online and offline.
- [ ] **All inputs** — touch, mouse, keyboard, pen; hover is never required;
  focus is visible.
- [ ] **Accessible** — semantic HTML, contrast, labels; installed apps are
  held to native-app expectations.
- [ ] **Progressive enhancement** — every PWA API behind feature detection
  (`"serviceWorker" in navigator`, `navigator.setAppBadge`, …); the site
  still works where it's missing.
- [ ] **Tested installed** on at least: Chrome desktop, Chrome Android,
  Safari iOS. Launch → offline → relaunch → navigate → update.

## Tier 3 — Robust: behaves like a native app over months of use

Caching that stays correct across deploys, updates that never break a
running session, and the integrations users expect from installed apps.

- [ ] **Shell precached at install** in a *versioned* cache, inside
  `event.waitUntil()` so a failed precache fails the install instead of
  shipping a half-cached app. **(audit)**
- [ ] **Old caches deleted on `activate`.** **(audit)**
- [ ] **Only GET is cached**; writes, auth and API calls that must be fresh
  are network-only. **(audit)**
- [ ] **A strategy per resource type**, written down: see
  `service-worker.md`. Hashed assets cache-first; HTML network-first;
  frequently-changing-but-tolerant data stale-while-revalidate; prices,
  stock, auth: network-only.
- [ ] **Deliberate update flow** — a new worker waits; the app tells the user
  an update is ready; on accept → `SKIP_WAITING` → reload once on
  `controllerchange`. Never swap code under a user mid-form. **(audit)**
- [ ] **Periodic update checks** (`registration.update()`) for long-lived
  tabs and installed windows that rarely navigate.
- [ ] **Offline-aware UI** — show offline state, queue user actions locally
  (IndexedDB), and replay them: Background Sync where supported, on
  `online` / next launch elsewhere. Never lose a user's input.
- [ ] **Storage** — request `navigator.storage.persist()` for apps holding
  user data; handle `QuotaExceededError`; remember browsers may evict.
- [ ] **Fast** — Core Web Vitals in budget; the shell renders from cache
  with zero network requests; code-split so the first route is small.
- [ ] **OS integration where it earns its place** (see
  `os-integration.md`): `shortcuts`, badging, share target, file and
  protocol handlers, `launch_handler`, notifications via Push — each behind
  feature detection, each with a reason.
- [ ] **Monochrome icon** and localized manifest members
  (`name_localized`, …) if you ship in several languages.
- [ ] **Permissions asked in context** — notifications only after a user
  action that makes the value obvious, never on first load.
- [ ] **Instrumented** — log SW install/activate/update failures, cache
  hit rate, offline sessions, install (`appinstalled`) and display mode, so
  regressions show up in telemetry rather than reviews.
- [ ] **Gated in CI** — `node scripts/audit.mjs dist --require robust`
  (relative to this skill's directory, or by absolute path), plus a
  browser test (e.g. Playwright) that goes offline and reloads.
