// Finds git worktrees that are done with (merged, or clean and idle) and
// removes them, so checkouts and their build output (target/, node_modules)
// stop piling up. It only ever does the safe forms: `git worktree remove`
// without --force (git refuses a worktree with changes) and `git branch -d`
// (git refuses an unmerged branch). A worktree something is still running
// in, or one holding ignored files that can't be rebuilt (a .env), is kept.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const DAY = 86_400_000;
export const STALE_DAYS = Number(process.env.LAUNCH_PROJECT_STALE_DAYS ?? 14);

/** Ignored paths that a build or install recreates; anything else ignored might be the only copy. */
const REBUILDABLE =
  /(^|\/)(node_modules|target|dist|build|out|coverage|\.next|\.nuxt|\.turbo|\.svelte-kit|\.vite|\.cache|\.parcel-cache|\.venv|venv|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.gradle|playwright-report|test-results|blob-report|\.pnpm-store|tsconfig\.tsbuildinfo|[^/]+\.tsbuildinfo|\.DS_Store)\/?$/;

const git = (cwd, ...args) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

/** `git worktree list --porcelain` as objects. The first is the main worktree. */
export function parseWorktreeList(porcelain) {
  return porcelain
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map((block, i) => {
      const wt = { main: i === 0 };
      for (const line of block.split("\n")) {
        const [key, ...rest] = line.split(" ");
        const value = rest.join(" ");
        if (key === "worktree") wt.path = value;
        else if (key === "HEAD") wt.head = value;
        else if (key === "branch") wt.branch = value.replace(/^refs\/heads\//, "");
        else if (key === "detached") wt.detached = true;
        else if (key === "bare") wt.bare = true;
        else if (key === "locked") wt.locked = value || true;
        else if (key === "prunable") wt.prunable = value || true;
      }
      return wt;
    });
}

/** Ignored entries (from `git status --ignored --porcelain`) that aren't rebuildable output. */
export function unrebuildableIgnored(statusPorcelain) {
  return statusPorcelain
    .split("\n")
    .filter((l) => l.startsWith("!! "))
    .map((l) => l.slice(3))
    .filter((p) => !REBUILDABLE.test(p));
}

/**
 * What to do with one worktree, from facts about it. Removing never loses
 * commits (the branch stays unless it's merged), so the bar is: nothing is
 * running there, nothing uncommitted, nothing ignored that can't be rebuilt.
 */
export function classify(f, staleDays = STALE_DAYS) {
  if (f.main) return { action: "keep", reason: "main worktree" };
  if (f.prunable) return { action: "prune", reason: "folder is gone; stale registration" };
  if (f.locked) return { action: "keep", reason: "locked" };
  if (f.inUse.length) {
    const shown = f.inUse.slice(0, 3).join(", ");
    return { action: "keep", reason: `in use (${shown}${f.inUse.length > 3 ? ` +${f.inUse.length - 3} more` : ""})` };
  }
  if (f.dirty) return { action: "keep", reason: `${f.dirty} uncommitted change${f.dirty === 1 ? "" : "s"}` };
  if (f.keepers.length) return { action: "keep", reason: `ignored files that may matter: ${f.keepers.slice(0, 3).join(", ")}` };
  if (f.merged) {
    return f.branch
      ? { action: "remove+branch", reason: `merged into ${f.merged}` }
      : { action: "remove", reason: `merged into ${f.merged}` };
  }
  if (f.idleDays >= staleDays) {
    return { action: "remove", reason: `clean, idle ${Math.round(f.idleDays)} days${f.branch ? `; branch ${f.branch} kept` : ""}` };
  }
  return { action: "keep", reason: `not merged, active ${Math.round(f.idleDays)} days ago` };
}

/** pid → cwd for every process we can see. */
export function processCwds() {
  const cwds = [];
  let pids = [];
  try {
    pids = readdirSync("/proc").filter((d) => /^\d+$/.test(d));
  } catch {}
  for (const pid of pids) {
    try {
      const cwd = readlinkSync(`/proc/${pid}/cwd`);
      const comm = readFileSync(`/proc/${pid}/comm`, "utf8").trim();
      if (Number(pid) !== process.pid) cwds.push({ pid: Number(pid), cwd, comm });
    } catch {}
  }
  return cwds;
}

/** The branches a merged worktree counts as merged into: origin's default, then local main/master. */
function baseRefs(repo) {
  const refs = [];
  const head = git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD");
  if (head.status === 0) refs.push(head.stdout.trim());
  for (const b of ["main", "master"]) {
    if (git(repo, "rev-parse", "--verify", "--quiet", `refs/heads/${b}`).status === 0) refs.push(b);
  }
  return refs;
}

function idleDays(wt, now) {
  const gitDir = git(wt.path, "rev-parse", "--absolute-git-dir").stdout.trim();
  const times = [Number(git(wt.path, "log", "-1", "--format=%ct").stdout.trim()) * 1000];
  for (const f of ["index", "HEAD", "logs/HEAD"]) {
    try {
      times.push(statSync(join(gitDir, f)).mtimeMs);
    } catch {}
  }
  return (now - Math.max(...times.filter(Number.isFinite))) / DAY;
}

/** Bytes on disk under `path`, or undefined if du can't say. */
export function diskBytes(path) {
  const r = spawnSync("du", ["-sb", path], { encoding: "utf8" });
  const n = Number.parseInt(r.stdout, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function human(bytes) {
  if (bytes === undefined) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${units[i]}`;
}

/** Every worktree of the repo at `dir`, with the facts `classify` needs and its verdict. */
export function scanRepo(dir, { now = Date.now(), cwds = processCwds(), staleDays = STALE_DAYS } = {}) {
  const list = git(dir, "worktree", "list", "--porcelain");
  if (list.status !== 0) return null;
  const worktrees = parseWorktreeList(list.stdout);
  const repo = worktrees[0].path;
  const bases = baseRefs(repo);
  return worktrees.map((wt) => {
    const f = { ...wt, inUse: [], dirty: 0, keepers: [], merged: undefined, idleDays: 0 };
    if (!wt.main && !wt.prunable && existsSync(wt.path)) {
      f.inUse = cwds
        .filter((p) => p.cwd === wt.path || p.cwd.startsWith(`${wt.path}/`))
        .map((p) => `${p.comm} ${p.pid}`);
      const status = git(wt.path, "status", "--porcelain", "--ignored").stdout;
      f.dirty = status.split("\n").filter((l) => l && !l.startsWith("!! ")).length;
      f.keepers = unrebuildableIgnored(status);
      f.merged = bases.find((b) => git(repo, "merge-base", "--is-ancestor", wt.head, b).status === 0);
      f.idleDays = idleDays(wt, now);
    } else if (!wt.main && !existsSync(wt.path)) {
      f.prunable = f.prunable ?? true;
    }
    return { ...f, repo, ...classify(f, staleDays) };
  });
}

/** Carries out a verdict. Only safe forms: git refuses anything that would lose work. */
export function cleanUp(wt) {
  if (wt.action === "prune") {
    const r = git(wt.repo, "worktree", "prune");
    return { ok: r.status === 0, note: r.status === 0 ? "pruned" : r.stderr.trim() };
  }
  if (wt.action !== "remove" && wt.action !== "remove+branch") return { ok: false, note: "kept" };
  const removed = git(wt.repo, "worktree", "remove", wt.path);
  if (removed.status !== 0) return { ok: false, note: `git refused: ${removed.stderr.trim()}` };
  if (wt.action === "remove+branch") {
    const del = git(wt.repo, "branch", "-d", wt.branch);
    if (del.status !== 0) return { ok: true, note: `removed; branch ${wt.branch} kept (git: ${del.stderr.trim().split("\n")[0]})` };
    return { ok: true, note: `removed; merged branch ${wt.branch} deleted` };
  }
  return { ok: true, note: "removed" };
}

/** Git repos directly in, or up to `depth` levels under, each root. */
export function findRepos(roots, depth = 2) {
  const repos = [];
  const walk = (dir, d) => {
    if (existsSync(join(dir, ".git"))) {
      if (statSync(join(dir, ".git")).isDirectory()) repos.push(dir);
      return;
    }
    if (d === 0) return;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {}
    for (const e of entries) if (e.isDirectory() && !e.name.startsWith(".")) walk(join(dir, e.name), d - 1);
  };
  for (const root of roots) walk(root, depth);
  return repos;
}

/** One line for a worktree verdict. */
export function describe(wt, bytes) {
  const rel = relative(wt.repo, wt.path);
  const where = rel && !rel.startsWith("..") ? rel : wt.path;
  const label = { keep: "keep", remove: "remove", "remove+branch": "remove", prune: "prune" }[wt.action];
  return `  ${label.padEnd(6)} ${where}${wt.branch ? ` (${wt.branch})` : ""} · ${wt.reason}${bytes !== undefined ? ` · ${human(bytes)}` : ""}`;
}
