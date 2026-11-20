# Web app manifest: what each member is for

A JSON file linked from every page with `<link rel="manifest">`. Relative
URLs inside it resolve against the **manifest's** URL, not the page's.
Start from `assets/manifest.webmanifest`.

## Identity and launch

| Member | Use | Notes |
|---|---|---|
| `name` | Full app name (install dialog, app list, task switcher) | Required (or `short_name`) |
| `short_name` | Label under the icon | ~12 characters max |
| `id` | Stable identity of the installed app | Same origin as `start_url`; defaults to `start_url`. Set once, never change |
| `start_url` | Page opened on launch | Must be in `scope`; a hint browsers may adjust; add `?source=pwa` if you want to measure installed launches |
| `scope` | URL path that belongs to the app | Navigating outside shows browser UI. Multiple frontends on one origin → disjoint scopes |
| `display` | `fullscreen` / `standalone` / `minimal-ui` / `browser` | Falls back in that order. `minimal-ui` keeps back/reload for multi-page sites without their own navigation |
| `display_override` | Ordered list tried before `display` | e.g. `["window-controls-overlay", "standalone"]` |
| `launch_handler` | `{ "client_mode": "focus-existing" \| "navigate-existing" \| "navigate-new" \| "auto" }` | Single-window apps: reuse the open window |
| `orientation` | Default orientation | Leave unset unless the app truly needs one |
| `lang`, `dir` | Language and direction of the text members | |

## Appearance

| Member | Use | Notes |
|---|---|---|
| `icons` | `[{src, sizes, type, purpose}]` | 192 and 512 PNG (`any`) required; a separate `maskable` (safe zone: central 80%); optional `monochrome` (alpha only). Design at 1024² with a transparent background |
| `theme_color` | Title bar / status bar / task switcher color | Mirror in `<meta name="theme-color">`, per color scheme |
| `background_color` | Splash and window color before CSS loads | Same as the page background |
| `screenshots` | `[{src, sizes, type, form_factor, label}]` | `wide` for desktop, `narrow` for mobile; enables the richer install UI. Each side 320–3840 px, aspect ratio ≤ 2.3, `sizes` must match the file |
| `description`, `categories` | Install dialog and stores | Optional; lowercase categories |

## OS integration (see `os-integration.md`)

`shortcuts`, `share_target`, `file_handlers`, `protocol_handlers`,
`note_taking`, `scope_extensions`, `related_applications` +
`prefer_related_applications`.

## Localization

`name_localized`, `short_name_localized`, `description_localized`,
`icons_localized`, … map language tags to variants; the browser picks by the
user's language and falls back to the plain member.

## Pitfalls

- `prefer_related_applications: true` blocks install in Chromium.
- `purpose: "any maskable"` on one icon crops the regular icon or pads the
  maskable one — use two files.
- Icon `sizes` must match the real pixels; browsers skip icons that lie.
- Generated manifests (framework plugins) often miss `id`, `scope` and
  screenshots — audit the built output, not the config.
