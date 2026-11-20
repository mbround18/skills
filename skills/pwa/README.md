# pwa

Turn the web frontend you already have into a proper Progressive Web App:
installable on desktop and phones, usable offline, quick to launch and
updated without breaking anyone's session. It works the same whether the
app is React, Vue, Svelte, server-rendered templates or hand-written HTML,
because everything it adds is plain files: a manifest, a service worker, a
few `<head>` tags.

## What you get

- **A checklist in three tiers.** *Minimum* gets you installable with no
  dead offline page. *Compatible* makes it right on Chrome, Android, iOS and
  macOS Safari. *Robust* covers versioned caches, safe updates, offline
  queues, storage and OS integration. Each item says why it matters.
- **Templates with no dependencies**: a manifest, a service worker with a
  caching strategy per resource type, registration code that asks the user
  before updating, an offline page, and the `<head>` tags.
- **An audit** of your built output that names the tier each frontend
  reaches and how to fix what's missing. It can gate CI.
- **Reference notes** on caching strategies, manifest members and OS
  features, condensed from MDN with links back to the source.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/mbround18/skills/main/install.sh | bash -s -- pwa
```

This clones the repo into `~/.local/share/agent-skills` and links the skill
into `~/.claude/skills/pwa`; run it again to update. From a checkout of this
repo, `node scripts/install.mjs pwa` links your working copy instead.

Then ask your agent something like "make this app a PWA" or run `/pwa`.

## Use the audit yourself

```sh
pnpm build                                        # however your app builds
node ~/.claude/skills/pwa/scripts/audit.mjs dist
node ~/.claude/skills/pwa/scripts/audit.mjs apps/web/dist apps/admin/dist --require compatible
```

```text
dist: MINIMUM → next: compatible
  minimum
    ✓ every page links the manifest
    ✓ a 192x192 icon with purpose "any"
    …
  compatible
    ✗ a "maskable" icon for adaptive launchers
        fix: add a separate icon with purpose "maskable" whose artwork sits inside the central 80% safe zone
```

Add `--json` for machine-readable output. `--require <tier>` exits with 1
if any frontend falls short, or if two frontends share a manifest `id`.

The audit reads files only. HTTPS, headers and real offline behaviour still
need a browser: the checklist lists those checks.

## Requirements

- Node.js 26 or newer, for the audit
- Any frontend that builds to (or serves) HTML

## Credits

Built from the [MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
PWA guides, by Mozilla Contributors (CC-BY-SA 2.5), summarized in our own
words. See `references/sources.md`.
