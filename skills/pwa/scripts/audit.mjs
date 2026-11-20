#!/usr/bin/env node
// pwa audit: static PWA readiness check for one or more built frontends.
//
//   node scripts/audit.mjs <dist-dir> [more-dirs ...] [--json] [--require minimum|compatible|robust]
//
// Reads the files on disk (no browser, no network) and reports, per
// frontend, which tier of references/checklist.md it reaches and what is
// missing for the next one. Exit code 1 when --require is given and any
// frontend falls short of it, so it can gate CI.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, extname, join, posix, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TIERS = ["minimum", "compatible", "robust"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".svelte-kit", ".next/cache", "coverage"]);
const MAX_FILES = 2000;
const MAX_SCRIPT_BYTES = 4 * 1024 * 1024;
const APP_DISPLAY = new Set(["standalone", "fullscreen", "minimal-ui", "window-controls-overlay", "tabbed"]);
const SW_NAMES = ["sw.js", "service-worker.js", "serviceworker.js", "sw.mjs", "service-worker.mjs"];

/** Every file under dir (relative POSIX paths), skipping dependency and VCS folders. */
export function walk(dir) {
  const out = [];
  const stack = [""];
  while (stack.length && out.length < MAX_FILES) {
    const rel = stack.pop();
    for (const ent of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name) && !SKIP_DIRS.has(p)) stack.push(p);
      } else if (ent.isFile()) out.push(p);
    }
  }
  return out.sort();
}

function attrsOf(tag) {
  const a = {};
  for (const [, k, v1, v2, v3] of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) a[k.toLowerCase()] = v1 ?? v2 ?? v3;
  return a;
}

/** The PWA-relevant facts of one HTML page. */
export function parseHtml(html) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => attrsOf(m[0]));
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrsOf(m[0]));
  const rel = (r) => links.find((l) => (l.rel ?? "").toLowerCase().split(/\s+/).includes(r));
  const meta = (n) => metas.find((m) => (m.name ?? "").toLowerCase() === n);
  const htmlTag = html.match(/<html\b[^>]*>/i);
  return {
    manifest: rel("manifest")?.href ?? null,
    viewport: meta("viewport")?.content ?? null,
    themeColor: meta("theme-color")?.content ?? null,
    appleTouchIcon: rel("apple-touch-icon")?.href ?? null,
    lang: htmlTag ? (attrsOf(htmlTag[0]).lang ?? null) : null,
    title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim() || null,
    swRegistrations: swRegistrations(html),
  };
}

/** Script URLs passed to navigator.serviceWorker.register(...). `null` = registered with a non-literal URL. */
export function swRegistrations(code) {
  const out = [];
  for (const m of code.matchAll(/serviceWorker\s*\.\s*register\s*\(\s*(?:(['"`])([^'"`]+)\1|new\s+URL\(\s*(['"`])([^'"`]+)\3)?/g)) {
    out.push(m[2] ?? m[4] ?? null);
  }
  return out;
}

/** Width and height from a PNG's IHDR chunk, or null when the bytes aren't a PNG. */
export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Map a URL reference (as written in HTML or a manifest) onto a file under root.
 * Root-relative paths that don't exist are retried with leading segments
 * removed, so an app deployed under /app/ still resolves against its dist dir.
 */
export function resolveRef(root, fromFile, ref) {
  if (!ref || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//")) return null;
  const clean = decodeURI(ref.split(/[?#]/)[0]);
  if (!clean.startsWith("/")) {
    const p = posix.normalize(posix.join(posix.dirname(fromFile), clean));
    return p.startsWith("..") ? null : p;
  }
  const parts = clean.split("/").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const p = parts.slice(i).join("/");
    if (existsSync(join(root, p))) return p;
  }
  return parts.join("/") || null;
}

function sizesOf(icon) {
  return String(icon.sizes ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function purposesOf(icon) {
  return String(icon.purpose ?? "any")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** Facts about the service worker script(s) a frontend registers. */
export function analyzeServiceWorker(sw, clientCode = "") {
  const all = sw + "\n" + clientCode;
  const workbox = /workbox/i.test(sw);
  return {
    workbox,
    fetchHandler: /addEventListener\(\s*['"`]fetch['"`]|\bonfetch\s*=/.test(sw) || (workbox && /registerRoute|precacheAndRoute|NavigationRoute/.test(sw)),
    precache: (/addEventListener\(\s*['"`]install['"`]/.test(sw) && /caches\.open|\.addAll\(/.test(sw)) || (workbox && /precache/i.test(sw)),
    offlineFallback: /offline/i.test(sw) || (workbox && /setCatchHandler|offlineFallback/.test(sw)),
    cleanup: /caches\.delete\(/.test(sw) || /cleanupOutdatedCaches/.test(sw),
    getOnly: /\.method\s*[!=]==?\s*['"`](GET|POST)['"`]|['"`](GET|POST)['"`]\s*[!=]==?\s*[\w.]*method/i.test(sw) || workbox,
    updateFlow: /skipWaiting|clients\.claim/.test(sw) && /controllerchange|updatefound|\.waiting\b|SKIP_WAITING/.test(all),
  };
}

function check(tier, id, ok, msg, fix, advisory = false) {
  return { tier, id, ok: !!ok, advisory, msg, fix: ok ? undefined : fix };
}

/** Audit one built frontend directory. Returns { root, pages, manifest, serviceWorker, checks, tier, next }. */
export function auditDir(dirArg) {
  const root = resolve(dirArg);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`not a directory: ${dirArg}`);
  const files = walk(root);
  const htmlFiles = files.filter((f) => /\.html?$/i.test(f));
  const scriptFiles = files.filter((f) => /\.(m?js|cjs)$/i.test(f) && statSync(join(root, f)).size <= MAX_SCRIPT_BYTES);
  const pages = htmlFiles.map((f) => ({ file: f, ...parseHtml(readFileSync(join(root, f), "utf8")) }));
  const entry = pages.find((p) => p.file === "index.html") ?? pages[0];
  const checks = [];
  const result = { root, pages: pages.length, manifest: null, serviceWorker: null, checks, tier: null, next: "minimum" };

  if (!pages.length) {
    checks.push(check("minimum", "pages", false, "no HTML pages found", "point the audit at the built output (dist/, build/, out/, public/), not the source tree"));
    return finish(result);
  }

  // ---- manifest ----------------------------------------------------------
  const missingLink = pages.filter((p) => !p.manifest).map((p) => p.file);
  checks.push(check("minimum", "manifest-linked", !missingLink.length, `every page links the manifest${missingLink.length ? ` (missing: ${list(missingLink)})` : ""}`, 'add <link rel="manifest" href="/manifest.webmanifest"> to the <head> of every page, including ones a server or router renders'));

  const ref = entry.manifest ?? pages.find((p) => p.manifest)?.manifest;
  const manifestFile = ref ? resolveRef(root, entry.manifest ? entry.file : pages.find((p) => p.manifest).file, ref) : null;
  let m = null;
  let manifestError = ref ? null : "no page links a manifest";
  if (ref && !manifestFile) manifestError = `manifest is on another origin (${ref}); audit that origin's files`;
  else if (manifestFile && !existsSync(join(root, manifestFile))) manifestError = `manifest ${manifestFile} is linked but not in the build`;
  else if (manifestFile) {
    try {
      m = JSON.parse(readFileSync(join(root, manifestFile), "utf8"));
      if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error("not a JSON object");
    } catch (err) {
      manifestError = `manifest ${manifestFile} is not valid JSON: ${err.message}`;
      m = null;
    }
  }
  const distinct = [...new Set(pages.map((p) => p.manifest).filter(Boolean))];
  checks.push(check("minimum", "manifest-valid", m, m ? `manifest ${manifestFile} parses${distinct.length > 1 ? ` (warning: pages link ${distinct.length} different manifests)` : ""}` : manifestError, "ship a JSON manifest (start from assets/manifest.webmanifest) and make sure the build copies it"));
  result.manifest = m ? { file: manifestFile, id: m.id ?? m.start_url ?? null, name: m.name ?? m.short_name ?? null } : null;
  const mf = m ?? {};

  checks.push(check("minimum", "name", mf.name || mf.short_name, "manifest has name or short_name", "set name (full) and short_name (≤ 12 characters for home screens)"));

  const icons = Array.isArray(mf.icons) ? mf.icons : [];
  const iconIssues = [];
  const anyIcons = icons.filter((i) => purposesOf(i).includes("any"));
  for (const icon of icons) {
    const file = manifestFile && resolveRef(root, manifestFile, icon.src);
    if (!file) continue;
    if (!existsSync(join(root, file))) {
      iconIssues.push(`${icon.src} not found`);
      continue;
    }
    const size = extname(file).toLowerCase() === ".png" ? pngSize(readFileSync(join(root, file))) : null;
    const declared = sizesOf(icon).filter((s) => s !== "any");
    if (size && declared.length && !declared.includes(`${size.width}x${size.height}`)) iconIssues.push(`${icon.src} is ${size.width}x${size.height} but declares ${declared.join(" ")}`);
  }
  for (const px of [192, 512]) {
    const has = anyIcons.some((i) => sizesOf(i).includes(`${px}x${px}`));
    checks.push(check("minimum", `icon-${px}`, has, `a ${px}x${px} icon with purpose "any"`, `add a ${px}x${px} PNG to icons (purpose "any", or omit purpose)`));
  }
  checks.push(check("minimum", "icon-files", !iconIssues.length, `icon files exist and match their declared sizes${iconIssues.length ? ` (${list(iconIssues)})` : ""}`, "fix the icon paths or regenerate the images at the sizes the manifest declares"));

  checks.push(check("minimum", "start_url", typeof mf.start_url === "string", "manifest has start_url", 'set start_url (usually "/" or "./")'));
  const modes = [mf.display, ...(Array.isArray(mf.display_override) ? mf.display_override : [])].filter(Boolean);
  checks.push(check("minimum", "display", modes.some((d) => APP_DISPLAY.has(d)), `display is app-like (${modes.join(", ") || "browser by default"})`, 'set display to "standalone" (or "minimal-ui" for multi-page sites without their own navigation)'));
  checks.push(check("minimum", "prefer-web", mf.prefer_related_applications !== true, "prefer_related_applications is not true", "remove prefer_related_applications, or set it to false: true blocks install in Chromium"));

  const noViewport = pages.filter((p) => !p.viewport).map((p) => p.file);
  checks.push(check("minimum", "viewport", !noViewport.length, `every page has a viewport meta${noViewport.length ? ` (missing: ${list(noViewport)})` : ""}`, '<meta name="viewport" content="width=device-width, initial-scale=1">'));

  // ---- service worker ------------------------------------------------------
  let clientCode = "";
  const regs = [];
  for (const p of pages) for (const r of p.swRegistrations) regs.push({ from: p.file, url: r });
  for (const f of scriptFiles) {
    const code = readFileSync(join(root, f), "utf8");
    const found = swRegistrations(code);
    if (found.length) clientCode += code + "\n";
    for (const r of found) regs.push({ from: f, url: r });
  }
  for (const p of htmlFiles) {
    const html = readFileSync(join(root, p), "utf8");
    if (/serviceWorker/.test(html)) clientCode += html + "\n";
  }
  let swFile = null;
  for (const r of regs) {
    if (!r.url) continue;
    // register() URLs resolve against the page, not the bundle that calls it.
    const fromPage = /\.html?$/i.test(r.from) ? r.from : (entry?.file ?? "index.html");
    const f = resolveRef(root, fromPage, r.url);
    if (f && existsSync(join(root, f))) {
      swFile = f;
      break;
    }
  }
  if (!swFile && regs.length) swFile = SW_NAMES.find((n) => existsSync(join(root, n))) ?? null;
  checks.push(check("minimum", "sw-registered", regs.length && swFile, regs.length ? (swFile ? `service worker ${swFile} is registered` : "a service worker is registered but its script is not in the build") : "no navigator.serviceWorker.register() call found", "register a service worker from the page (assets/register-sw.js) and ship its script at the root of the app's scope"));
  const sw = swFile ? analyzeServiceWorker(readFileSync(join(root, swFile), "utf8"), clientCode) : analyzeServiceWorker("", clientCode);
  result.serviceWorker = swFile ? { file: swFile, workbox: sw.workbox } : null;
  checks.push(check("minimum", "sw-fetch", sw.fetchHandler, "service worker handles fetch", "add a fetch handler: without one the worker can't serve anything offline"));
  checks.push(check("minimum", "sw-offline", sw.offlineFallback, "service worker serves an offline fallback", "precache an offline page and return it when a navigation request fails"));

  // ---- compatible ----------------------------------------------------------
  checks.push(check("compatible", "id", typeof mf.id === "string", "manifest has an explicit id", 'set id (e.g. "/") so the installed app keeps its identity if start_url ever changes'));
  if (typeof mf.scope === "string" && typeof mf.start_url === "string") {
    const base = new URL(manifestFile ? `/${manifestFile}` : "/", "https://app.invalid");
    const scope = new URL(mf.scope, base).pathname;
    const start = new URL(mf.start_url, base).pathname;
    checks.push(check("compatible", "start-in-scope", start.startsWith(scope), `start_url ${start} is inside scope ${scope}`, "move start_url inside scope (or widen scope): otherwise launch opens outside the app"));
  }
  checks.push(check("compatible", "icon-maskable", icons.some((i) => purposesOf(i).includes("maskable")), 'a "maskable" icon for adaptive launchers', 'add a separate icon with purpose "maskable" whose artwork sits inside the central 80% safe zone'));
  checks.push(check("compatible", "colors", mf.theme_color && mf.background_color, "manifest has theme_color and background_color", "set background_color to the page background and theme_color to the toolbar color"));
  checks.push(check("compatible", "description", mf.description, "manifest has a description", "add a one-sentence description: install dialogs and stores show it"));
  const shots = Array.isArray(mf.screenshots) ? mf.screenshots : [];
  const wide = shots.some((s) => s.form_factor === "wide");
  const narrow = shots.some((s) => s.form_factor !== "wide");
  checks.push(check("compatible", "screenshots", wide && narrow, `screenshots for wide and narrow screens (${shots.length} found)`, 'add screenshots with form_factor "wide" (desktop) and "narrow" (mobile) for the richer install dialog'));
  checks.push(check("compatible", "apple-touch-icon", entry.appleTouchIcon, `entry page ${entry.file} has an apple-touch-icon`, '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"> (180x180, opaque background) for iOS and iPadOS home screens'));
  checks.push(check("compatible", "theme-color-meta", entry.themeColor, `entry page ${entry.file} has <meta name="theme-color">`, "add a theme-color meta (optionally one per prefers-color-scheme) matching manifest theme_color"));
  const noLang = pages.filter((p) => !p.lang || !p.title).map((p) => p.file);
  checks.push(check("compatible", "lang-title", !noLang.length, `every page has <html lang> and a <title>${noLang.length ? ` (missing: ${list(noLang)})` : ""}`, "set lang on <html> and a meaningful <title>: screen readers and app switchers use them"));

  // ---- robust --------------------------------------------------------------
  checks.push(check("robust", "sw-precache", sw.precache, "service worker precaches the app shell at install", "open a versioned cache in the install handler and addAll() the shell, wrapped in event.waitUntil()"));
  checks.push(check("robust", "sw-cleanup", sw.cleanup, "old caches are deleted on activate", "in the activate handler, delete every cache whose name isn't the current version"));
  checks.push(check("robust", "sw-get-only", sw.getOnly, "service worker only caches GET requests", "skip non-GET requests in the fetch handler: never cache POST/PUT"));
  checks.push(check("robust", "sw-update", sw.updateFlow, "new versions are picked up deliberately (waiting worker → skipWaiting → reload)", "tell the user an update is ready, then post SKIP_WAITING and reload on controllerchange (see assets/register-sw.js)"));
  checks.push(check("robust", "shortcuts", Array.isArray(mf.shortcuts) && mf.shortcuts.length, "manifest defines shortcuts for key tasks", "add 2–4 shortcuts (name, url, 96x96 icon) for the actions people repeat most", true));
  checks.push(check("robust", "icon-monochrome", icons.some((i) => purposesOf(i).includes("monochrome")), 'a "monochrome" icon for badges and tinted surfaces', 'add an icon with purpose "monochrome" (alpha-only silhouette)', true));

  return finish(result);
}

function list(xs) {
  return xs.length > 4 ? `${xs.slice(0, 4).join(", ")} +${xs.length - 4} more` : xs.join(", ");
}

function finish(result) {
  let tier = null;
  for (const t of TIERS) {
    if (result.checks.some((c) => c.tier === t && !c.ok && !c.advisory)) break;
    tier = t;
  }
  result.tier = tier;
  result.next = tier === "robust" ? null : TIERS[TIERS.indexOf(tier) + 1];
  return result;
}

/** Checks that span frontends deployed side by side. */
export function crossChecks(results) {
  const byId = new Map();
  for (const r of results) if (r.manifest?.id) byId.set(r.manifest.id, [...(byId.get(r.manifest.id) ?? []), r.root]);
  return [...byId].filter(([, roots]) => roots.length > 1).map(([id, roots]) => ({
    id: "distinct-ids",
    ok: false,
    msg: `manifest id ${id} is shared by ${roots.map((r) => basename(r)).join(", ")}`,
    fix: "if these frontends share an origin, give each its own id, scope and service worker scope, or merge them into one app",
  }));
}

const MARK = { true: "✓", false: "✗" };

export function formatReport(results, cross = []) {
  const out = [];
  for (const r of results) {
    const rel = relative(process.cwd(), r.root);
    out.push(`${rel.startsWith("..") ? r.root : rel || "."}:${r.tier ? r.tier.toUpperCase() : "NOT A PWA YET"}${r.next ? ` → next: ${r.next}` : " (all tiers met)"}`);
    for (const t of TIERS) {
      const cs = r.checks.filter((c) => c.tier === t);
      if (!cs.length) continue;
      out.push(`  ${t}`);
      for (const c of cs) {
        out.push(`    ${c.ok ? MARK.true : c.advisory ? "·" : MARK.false} ${c.msg}`);
        if (!c.ok) out.push(`        fix: ${c.fix}`);
      }
    }
    out.push("");
  }
  for (const c of cross) out.push(`✗ ${c.msg}\n    fix: ${c.fix}`);
  out.push("Not checkable from files: served over HTTPS, offline launch in a real browser, install on iOS/Android/desktop. See references/checklist.md.");
  return out.join("\n");
}

export function parseArgs(argv) {
  const a = { dirs: [], json: false, require: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--json") a.json = true;
    else if (v === "--require") {
      a.require = argv[++i];
      if (!TIERS.includes(a.require)) throw new Error(`--require takes one of ${TIERS.join(", ")}`);
    } else if (v === "-h" || v === "--help") a.help = true;
    else if (v.startsWith("--")) throw new Error(`unknown option ${v}`);
    else a.dirs.push(v);
  }
  return a;
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help || !opts.dirs.length) {
    console.error("usage: audit.mjs <dist-dir> [more ...] [--json] [--require minimum|compatible|robust]");
    process.exitCode = opts.help ? 0 : 2;
    return;
  }
  const results = opts.dirs.map(auditDir);
  const cross = crossChecks(results);
  if (opts.json) console.log(JSON.stringify({ frontends: results, cross }, null, 2));
  else console.log(formatReport(results, cross));
  if (opts.require) {
    const need = TIERS.indexOf(opts.require);
    if (results.some((r) => TIERS.indexOf(r.tier) < need) || cross.length) process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    main();
  } catch (err) {
    console.error(`pwa audit: ${err.message}`);
    process.exitCode = 1;
  }
}

