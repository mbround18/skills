import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { analyzeServiceWorker, auditDir, crossChecks, parseHtml, pngSize, resolveRef, swRegistrations } from "../scripts/audit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const skill = join(here, "..");
const assets = join(skill, "assets");
const tmp = mkdtempSync(join(tmpdir(), "pwa-audit-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

/** Smallest byte sequence pngSize() accepts: signature + IHDR header. */
function png(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

let n = 0;
function site(files) {
  const dir = join(tmp, `site-${++n}`);
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}

const page = (head = "", body = "") => `<!doctype html><html lang="en"><head><title>T</title>${head}</head><body>${body}</body></html>`;
const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const MIN_MANIFEST = { name: "App", start_url: "/", display: "standalone", icons: [{ src: "/i192.png", sizes: "192x192" }, { src: "/i512.png", sizes: "512x512" }] };
const MIN_SW = `self.addEventListener("fetch", (e) => e.respondWith(fetch(e.request).catch(() => caches.match("/offline.html"))));`;

function minimumSite(extra = {}) {
  return site({
    "index.html": page(`${VIEWPORT}<link rel="manifest" href="/app.webmanifest"><script>navigator.serviceWorker.register("/sw.js")</script>`),
    "app.webmanifest": JSON.stringify(MIN_MANIFEST),
    "i192.png": png(192, 192),
    "i512.png": png(512, 512),
    "sw.js": MIN_SW,
    ...extra,
  });
}

const failing = (r) => r.checks.filter((c) => !c.ok && !c.advisory).map((c) => c.id);

test("pngSize reads IHDR and rejects non-PNG bytes", () => {
  assert.deepEqual(pngSize(png(192, 96)), { width: 192, height: 96 });
  assert.equal(pngSize(Buffer.from("GIF89a not a png at all......")), null);
});

test("parseHtml finds manifest, viewport, theme color, touch icon, lang and title in any attribute order", () => {
  const p = parseHtml(`<html data-x lang='fr'><head><title> Hi </title><link href="/m.json" rel="manifest"><meta content="#000" name="theme-color"><link rel="apple-touch-icon" href=/t.png></head></html>`);
  assert.equal(p.manifest, "/m.json");
  assert.equal(p.themeColor, "#000");
  assert.equal(p.appleTouchIcon, "/t.png");
  assert.equal(p.lang, "fr");
  assert.equal(p.title, "Hi");
  assert.equal(p.viewport, null);
});

test("swRegistrations handles literals, new URL() and dynamic URLs", () => {
  assert.deepEqual(swRegistrations(`navigator.serviceWorker.register('/sw.js',{scope:'/'})`), ["/sw.js"]);
  assert.deepEqual(swRegistrations(`navigator.serviceWorker.register(new URL("./sw.js", import.meta.url))`), ["./sw.js"]);
  assert.deepEqual(swRegistrations(`navigator.serviceWorker.register(swUrl)`), [null]);
});

test("resolveRef maps relative, root-relative and prefixed paths; ignores other origins", () => {
  const dir = site({ "manifest.json": "{}", "icons/a.png": "x" });
  assert.equal(resolveRef(dir, "sub/page.html", "../manifest.json"), "manifest.json");
  assert.equal(resolveRef(dir, "index.html", "/manifest.json"), "manifest.json");
  assert.equal(resolveRef(dir, "index.html", "/my-app/icons/a.png?v=2"), "icons/a.png");
  assert.equal(resolveRef(dir, "index.html", "https://cdn.example/m.json"), null);
});

test("an empty directory is not a PWA and says to point at built output", () => {
  const r = auditDir(site({ "readme.txt": "hi" }));
  assert.equal(r.tier, null);
  assert.deepEqual(failing(r), ["pages"]);
});

test("a plain website fails minimum with a fix for each gap", () => {
  const r = auditDir(site({ "index.html": page() }));
  assert.equal(r.tier, null);
  for (const id of ["manifest-linked", "manifest-valid", "name", "icon-192", "icon-512", "start_url", "display", "viewport", "sw-registered", "sw-fetch", "sw-offline"]) assert.ok(failing(r).includes(id), id);
  assert.ok(r.checks.filter((c) => !c.ok).every((c) => c.fix));
});

test("manifest + icons + fetch-handling worker with offline fallback reaches minimum", () => {
  const r = auditDir(minimumSite());
  assert.deepEqual(failing(r).filter((id) => r.checks.find((c) => c.id === id).tier === "minimum"), []);
  assert.equal(r.tier, "minimum");
  assert.equal(r.next, "compatible");
  assert.equal(r.serviceWorker.file, "sw.js");
});

test("a page missing the manifest link, or an icon lying about its size, blocks minimum", () => {
  const r = auditDir(minimumSite({ "about/index.html": page(VIEWPORT), "i512.png": png(256, 256) }));
  assert.equal(r.tier, null);
  assert.ok(failing(r).includes("manifest-linked"));
  assert.match(r.checks.find((c) => c.id === "manifest-linked").msg, /about\/index\.html/);
  assert.match(r.checks.find((c) => c.id === "icon-files").msg, /256x256 but declares 512x512/);
});

test("prefer_related_applications: true and display: browser are not installable", () => {
  const r = auditDir(minimumSite({ "app.webmanifest": JSON.stringify({ ...MIN_MANIFEST, display: "browser", prefer_related_applications: true }) }));
  assert.ok(failing(r).includes("display"));
  assert.ok(failing(r).includes("prefer-web"));
});

test("registration from a bundled script resolves against the page and finds the worker", () => {
  const dir = site({
    "index.html": page(`${VIEWPORT}<link rel="manifest" href="app.webmanifest"><script type="module" src="assets/main.js"></script>`),
    "assets/main.js": `if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");`,
    "app.webmanifest": JSON.stringify(MIN_MANIFEST),
    "i192.png": png(192, 192),
    "i512.png": png(512, 512),
    "sw.js": MIN_SW,
  });
  assert.equal(auditDir(dir).tier, "minimum");
});

test("start_url outside scope fails compatible", () => {
  const r = auditDir(minimumSite({ "app.webmanifest": JSON.stringify({ ...MIN_MANIFEST, scope: "/app/", start_url: "/" }) }));
  assert.ok(failing(r).includes("start-in-scope"));
});

test("analyzeServiceWorker recognises a Workbox-generated worker", () => {
  const sw = analyzeServiceWorker(`importScripts("workbox-sw.js"); workbox.precaching.precacheAndRoute([]); workbox.precaching.cleanupOutdatedCaches(); workbox.routing.setCatchHandler(() => {}); self.skipWaiting();`, `wb.addEventListener("waiting", ...); navigator.serviceWorker.addEventListener("controllerchange", r)`);
  assert.ok(sw.workbox && sw.fetchHandler && sw.precache && sw.cleanup && sw.offlineFallback && sw.getOnly && sw.updateFlow);
});

test("a Workbox navigateFallback (SPA shell) counts as an offline fallback", () => {
  // Minified shape vite-plugin-pwa / workbox-build emit for navigateFallback: "index.html".
  const gen = `define(["./workbox-2ff6bd68"],(function(s){s.precacheAndRoute([{url:"index.html",revision:"1"}],{}),s.cleanupOutdatedCaches(),s.registerRoute(new s.NavigationRoute(s.createHandlerBoundToURL("index.html"),{denylist:[/^\\/api/]}))}));`;
  assert.ok(analyzeServiceWorker(gen, "").offlineFallback);
  assert.ok(!analyzeServiceWorker(`define(["./workbox-1"],(function(s){s.precacheAndRoute([])}));`, "").offlineFallback);
});

test("the shipped templates, dropped into a build, reach robust", () => {
  const manifest = JSON.parse(readFileSync(join(assets, "manifest.webmanifest"), "utf8"));
  const files = {
    "index.html": `<!doctype html><html lang="en"><head><title>App</title>${readFileSync(join(assets, "head.html"), "utf8")}</head><body></body></html>`,
    "icons/apple-touch-icon.png": png(180, 180),
  };
  for (const i of manifest.icons) files[i.src.slice(1)] = png(...i.sizes.split("x").map(Number));
  for (const s of manifest.screenshots) files[s.src.slice(1)] = png(...s.sizes.split("x").map(Number));
  const dir = site(files);
  for (const f of ["manifest.webmanifest", "sw.js", "register-sw.js", "offline.html"]) copyFileSync(join(assets, f), join(dir, f));
  const r = auditDir(dir);
  assert.deepEqual(r.checks.filter((c) => !c.ok).map((c) => c.id), []);
  assert.equal(r.tier, "robust");
  assert.equal(r.next, null);
});

test("crossChecks flags two frontends sharing a manifest id", () => {
  const a = auditDir(minimumSite());
  const b = auditDir(minimumSite());
  assert.equal(crossChecks([a, b]).length, 1);
});

test("CLI: --require exits 1 when short, 0 when met; --json is parseable", () => {
  const cli = join(skill, "scripts", "audit.mjs");
  const dir = minimumSite();
  assert.equal(spawnSync(process.execPath, [cli, dir, "--require", "compatible"]).status, 1);
  assert.equal(spawnSync(process.execPath, [cli, dir, "--require", "minimum"]).status, 0);
  const out = JSON.parse(execFileSync(process.execPath, [cli, dir, "--json"], { encoding: "utf8" }));
  assert.equal(out.frontends[0].tier, "minimum");
  const usage = spawnSync(process.execPath, [cli], { encoding: "utf8" });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage/);
});
