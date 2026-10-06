#!/usr/bin/env node
// Prints the facts TOMORROW.md must get right, straight from git, so the
// note is written from the tree rather than from memory: branch, HEAD and
// its signature verdict, ahead/behind upstream, every dirty path, the
// worktree list — and which way this call should go. A note is stamped
// when written; if nothing in the tree has moved since the stamp, the
// caller is coming back to it (pickup); if work happened after it, the note
// is behind and must be rewritten (write). An hour, a day or a week later
// all look the same; a stamp in the future means a clock is wrong.
//
//   node scripts/snapshot.mjs [repo-path ...]     (default: cwd)

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const NOTE_FILE = "TOMORROW.md";

/** Edits this soon after the stamp are the pause itself (committing the note). */
export const PAUSE_GRACE_MS = 15 * 60 * 1000;

/** Run git in `cwd`, returning trimmed stdout, or `null` if git fails. */
export function git(cwd, args, { trim = true } = {}) {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return trim ? out.trim() : out;
  } catch {
    return null;
  }
}

/** Parse `git status --porcelain=v1` into {status, path} entries. */
export function parseStatus(porcelain) {
  if (!porcelain) return [];
  return porcelain
    .split("\n")
    .filter((line) => line.length > 3)
    .map((line) => ({ status: line.slice(0, 2), path: line.slice(3) }));
}

/** Parse `git rev-list --left-right --count @{u}...HEAD` into {behind, ahead}. */
export function parseAheadBehind(counts) {
  if (!counts) return null;
  const [behind, ahead] = counts.split(/\s+/).map(Number);
  if (Number.isNaN(behind) || Number.isNaN(ahead)) return null;
  return { behind, ahead };
}

/** The machine-readable stamp a note carries on its first lines. */
export function stampLine(date = new Date()) {
  return `<!-- tomorrow: ${date.toISOString()} -->`;
}

/**
 * When the note was written: the `<!-- tomorrow: ISO -->` stamp, or for an
 * older hand-written note the "end of YYYY-MM-DD" phrase (taken as the start
 * of that day, so anything done that day counts as after it). `null` when
 * neither is present.
 */
export function noteStamp(text) {
  const iso = text.match(/<!--\s*tomorrow:\s*([^\s]+)\s*-->/);
  if (iso) {
    const date = new Date(iso[1]);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const day = text.match(/end of (\d{4}-\d{2}-\d{2})/);
  if (day) return new Date(`${day[1]}T00:00:00Z`);
  return null;
}

/**
 * Decide the mode from timestamps alone.
 *
 * - no note                         → write
 * - stamp after `now`               → write, with a clock warning
 * - tree moved after stamp + grace  → write (the note is behind the work)
 * - otherwise                       → pickup (resume from the note)
 *
 * `activity` is the latest time anything in the tree changed: the HEAD
 * commit, or a dirty file's mtime (the note itself excluded).
 */
export function decideMode({ stamp, activity, now = new Date() }) {
  if (!stamp) return { mode: "write", reason: "no note" };
  if (stamp.getTime() > now.getTime()) {
    return {
      mode: "write",
      reason: `note is stamped in the future (${stamp.toISOString()} > ${now.toISOString()}); a clock is wrong`,
    };
  }
  if (activity && activity.getTime() > stamp.getTime() + PAUSE_GRACE_MS) {
    return {
      mode: "write",
      reason: `the tree changed at ${activity.toISOString()}, after the note (${stamp.toISOString()})`,
    };
  }
  return {
    mode: "pickup",
    reason: `nothing has moved since the note (${stamp.toISOString()}); ${describeAge(now.getTime() - stamp.getTime())} ago`,
  };
}

/** "47 minutes", "2 days", "3 weeks". */
export function describeAge(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  const weeks = Math.round(days / 7);
  return `${weeks} week${weeks === 1 ? "" : "s"}`;
}

/** Latest of the HEAD commit time and the dirty files' mtimes, note excluded. */
export function latestActivity(top, dirty) {
  const times = [];
  const headTime = git(top, ["log", "-1", "--format=%cI"]);
  if (headTime) times.push(new Date(headTime).getTime());
  for (const entry of dirty) {
    if (entry.path === NOTE_FILE) continue;
    try {
      times.push(statSync(join(top, entry.path)).mtimeMs);
    } catch {
      // deleted paths have no mtime; the HEAD time covers them
    }
  }
  return times.length ? new Date(Math.max(...times)) : null;
}

/** Gather everything about one checkout. Pure data; `render` prints it. */
export function snapshot(path, now = new Date()) {
  const cwd = resolve(path);
  const top = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!top) return { path: cwd, git: false };

  const notePath = join(top, NOTE_FILE);
  const stamp = existsSync(notePath) ? noteStamp(readFileSync(notePath, "utf8")) : null;
  // Untrimmed: a " M" status begins with the space trim would eat.
  const dirty = parseStatus(git(top, ["status", "--porcelain=v1"], { trim: false }));
  const activity = latestActivity(top, dirty);
  return {
    path: top,
    git: true,
    branch: git(top, ["rev-parse", "--abbrev-ref", "HEAD"]),
    head: git(top, ["log", "-1", "--format=%h %G? %s"]),
    upstream: git(top, ["rev-parse", "--abbrev-ref", "@{u}"]),
    aheadBehind: parseAheadBehind(
      git(top, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]),
    ),
    dirty,
    worktrees: (git(top, ["worktree", "list"]) ?? "").split("\n").filter(Boolean),
    hasNote: existsSync(notePath),
    stamp,
    activity,
    decision: decideMode({ stamp, activity, now }),
  };
}

/** Human-readable block for one snapshot. */
export function render(snap) {
  if (!snap.git) return `${snap.path}\n  not a git repository\n`;
  const lines = [snap.path];
  lines.push(`  branch   ${snap.branch}`);
  lines.push(`  HEAD     ${snap.head}   (G = good signature, N = unsigned)`);
  if (snap.upstream && snap.aheadBehind) {
    lines.push(
      `  upstream ${snap.upstream}: ${snap.aheadBehind.ahead} ahead, ${snap.aheadBehind.behind} behind`,
    );
  } else {
    lines.push("  upstream none");
  }
  lines.push(
    snap.dirty.length === 0
      ? "  tree     clean"
      : `  tree     ${snap.dirty.length} uncommitted:`,
  );
  for (const entry of snap.dirty) lines.push(`    ${entry.status} ${entry.path}`);
  if (snap.worktrees.length > 1) {
    lines.push("  worktrees");
    for (const wt of snap.worktrees) lines.push(`    ${wt}`);
  }
  if (!snap.hasNote) lines.push(`  note     none`);
  else if (!snap.stamp) lines.push(`  note     present, unstamped (add "${stampLine()}")`);
  else lines.push(`  note     stamped ${snap.stamp.toISOString()}`);
  lines.push(`  mode     ${snap.decision.mode} — ${snap.decision.reason}`);
  return lines.join("\n") + "\n";
}

export function main(argv = process.argv.slice(2)) {
  const paths = argv.length > 0 ? argv : [process.cwd()];
  for (const path of paths) process.stdout.write(render(snapshot(path)));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
