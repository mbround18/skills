---
name: pwa
description: Turns one or more existing web frontends into solid Progressive Web Apps, whatever the framework, language or build tool — installable, offline-capable, fast and well integrated with the OS. Gives the driving factors to decide by, a tiered checklist (minimum → fully compatible → robust), framework-free templates (manifest, service worker, update-aware registration, offline page) and a static audit that reports which tier each built frontend reaches. Use when the user wants to make a site or app a PWA, installable, work offline, add a manifest or service worker, fix "not installable", add an install button, push, badges or share targets, or review PWA readiness.
license: BSD-3-Clause
compatibility: Any web frontend. The audit script needs Node.js 26+ and reads built output from disk; no browser or network.
metadata:
  author: mbround18
user-invocable: true
argument-hint: "[frontend dir ...] [--require minimum|compatible|robust]"
---

# pwa

Make an existing frontend a Progressive Web App without rewriting it. A PWA
is still a website: one codebase, any framework (or none), progressively
enhanced with a **web app manifest** (identity, icons, how it launches) and
a **service worker** (offline, caching, background work).

Paths below (`scripts/`, `assets/`, `references/`) are
relative to this skill's directory (the folder holding this SKILL.md): run
from there, or give the script's absolute path.

## Driving factors

Decide every PWA question by these, in this order. When two conflict, the
earlier one wins.

1. **Never break the website.** Everything is progressive enhancement behind
   feature detection. A browser without service workers or install still
   gets a working site.
2. **Never lose user data or input.** No caching of writes; queue offline
   actions and replay them; never swap code under a user mid-task.
3. **Reliable before clever.** Offline fallback and a correct update flow
   come before push, badges or file handlers.
4. **Fresh where it matters, instant where it doesn't.** Choose a caching
   strategy per resource type, not one for the whole app.
5. **Installable everywhere it can be, honest where it can't.** Meet each
   platform's install criteria; don't show install UI that can't work
   (e.g. `beforeinstallprompt` on iOS).
6. **Feels like an app once installed.** Its own window, its own navigation,
   right colors and icons, deep links that work cold.
7. **Fast, accessible, every input.** Installed apps are judged against
   native ones.
8. **Integrate with the OS only where it earns its place.**
9. **Framework-agnostic.** Prefer plain files the build copies through (a
   `public/` or static folder) over framework plugins; if the project
   already uses a PWA plugin, configure it to the same checklist and audit
   its output.

## Workflow

1. **Inventory the frontends.** For each: where its built output lands
   (`dist/`, `build/`, `out/`, `public/`), where static files are copied
   from, how it is served (path prefix, SSR or static, client-side routing),
   and its origin. Several frontends on one origin need distinct manifest
   `id`s and non-overlapping `scope`s and service-worker scopes — or should
   be one app.
2. **Audit what exists.** Build, then run
   `node scripts/audit.mjs <dist-dir> [more ...]`. It prints the tier each
   frontend reaches and a fix for every gap (`--json` for machine output).
3. **Pick the target tier** with the user. Default: **compatible** for
   anything shipped to users; **robust** for apps people live in.
4. **Implement tier by tier**, following `references/checklist.md`. Copy and
   adapt the templates in `assets/`:
   - `manifest.webmanifest`: fill in name, colors, icons, screenshots
   - `head.html`: tags for every page's `<head>` (put them in the root
     layout, template or SSR shell, not one page)
   - `register-sw.js`: registration with a user-approved update flow
   - `sw.js`: the service worker; edit `SHELL`, `NETWORK_ONLY`, `VERSION`
   - `offline.html`: a self-contained fallback page
   Put them where the build copies static files to the output root, and
   ensure the server sends `sw.js` with `Cache-Control: no-cache`.
5. **Verify.** Re-run the audit (`--require <tier>` exits 1 if short; use it
   in CI). Then do the checks files can't prove: HTTPS, DevTools →
   Application (manifest errors, installability, service worker, offline
   toggle), install and relaunch offline on Chrome desktop, Android and iOS
   Safari, deploy a second version and confirm the update prompt.

## References

- `references/checklist.md` — the tiered checklist, with the reason for each item. **Start here.**
- `references/service-worker.md` — lifecycle, caching strategies by resource, background sync/fetch/push.
- `references/manifest.md` — every manifest member, what it's for, pitfalls.
- `references/os-integration.md` — shortcuts, badges, share, files, protocols, install prompts; support notes.
- `references/sources.md` — the MDN pages this is drawn from, for depth and current support.

## Audit limits

The audit reads files only. It can't see HTTP headers, HTTPS, redirects or
runtime behaviour, and it reads the service worker by pattern, so treat
its service-worker checks as "looks present", not "works". For pages
rendered only at request time (SSR without static output), point it at a
directory holding saved responses of the key pages plus the static assets.
