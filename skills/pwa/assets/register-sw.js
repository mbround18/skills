// Register the service worker and handle updates without surprising the
// user. Load from every page, e.g. <script type="module" src="/register-sw.js">,
// or import it from the app's entry module. Framework-agnostic.
//
// Updates: a new sw.js installs in the background and then waits. We show
// the user that an update is ready; when they accept, the waiting worker
// takes over (SKIP_WAITING) and the page reloads once, on controllerchange.

const SW_URL = "/sw.js";

export function onUpdateReady(worker) {
  // Replace with the app's own UI: a toast, a banner, a menu badge.
  const accept = () => worker.postMessage({ type: "SKIP_WAITING" });
  window.dispatchEvent(new CustomEvent("pwa:update-ready", { detail: { accept } }));
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null; // progressive enhancement: the site still works
  const registration = await navigator.serviceWorker.register(SW_URL, { scope: "/" });

  if (registration.waiting && navigator.serviceWorker.controller) onUpdateReady(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      // Only an *update* if a previous worker already controls the page.
      if (worker.state === "installed" && navigator.serviceWorker.controller) onUpdateReady(worker);
    });
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  // Long-lived tabs and installed apps rarely navigate: check hourly too.
  setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
  return registration;
}

if (document.readyState === "complete") registerServiceWorker();
else window.addEventListener("load", () => registerServiceWorker(), { once: true });
