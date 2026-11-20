# OS integration: features installed apps can use

Use each only where it serves the user, always behind feature detection,
and expect partial support (most are Chromium-first; several are
desktop-only). They take effect only once the app is installed.

| Feature | How | Support notes | Good for |
|---|---|---|---|
| **Standalone window** | `display: "standalone"`; style with `@media (display-mode: standalone)` | Broad | Every app. Display mode ≠ "installed"; there's no reliable cross-browser installed check |
| **Custom install button** | `beforeinstallprompt` → `preventDefault()`, keep the event, call `prompt()` once on click; hide on `appinstalled` | Chromium only; not iOS | Explaining *why* to install, at a moment that makes sense |
| **Detect native counterpart** | `related_applications` + `navigator.getInstalledRelatedApps()` | Chromium (mostly Android) | Not pushing a PWA install on someone who has the native app |
| **App shortcuts** | `shortcuts: [{name, short_name, url, icons}]` | Chromium desktop/Android; right-click or long-press icon | 2–4 most frequent tasks |
| **App badge** | `navigator.setAppBadge(n)` / `clearAppBadge()`, also from the worker | Windows/macOS via Chrome/Edge; iOS 16.4+ with notification permission; not Linux | Unread counts — keep them exact and clear them |
| **Notifications / Push** | Push API + `registration.showNotification()` | Needs permission; iOS only for home-screen apps | Things that can't wait until next launch |
| **Share from the app** | `navigator.share({title, text, url, files})` | Broad on mobile; feature-detect | Sharing content out |
| **Receive shares** | `share_target: {action, method, enctype, params}` | Chromium Android/ChromeOS | Apps that accept links, text or files |
| **Open files** | `file_handlers: [{action, accept}]` + `window.launchQueue` | Chromium desktop | Editors and viewers |
| **Handle links** | `protocol_handlers: [{protocol: "web+thing", url}]` | Chromium desktop | `mailto`-style custom schemes |
| **Launch behaviour** | `launch_handler.client_mode` | Chromium | Single-window apps |
| **Title bar** | `display_override: ["window-controls-overlay"]` | Chromium desktop | Dense desktop apps |
| **Note taking** | `note_taking.new_note_url` | ChromeOS | Notes apps |
| **Multiple origins as one app** | `scope_extensions` | Experimental | Apps split across origins |

Rule of thumb: tier-3 "robust" doesn't mean "all of these". Ship the
two or three that match what the app is for, done well.
