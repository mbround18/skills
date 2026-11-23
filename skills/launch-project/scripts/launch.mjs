#!/usr/bin/env node
// Starts `claude --remote-control` in a project directory, inside a named tmux
// session (when tmux is installed) with a terminal window attached to it, then
// exits. tmux is what makes a launched session reachable afterwards: `list`
// reads its screen, `trust` answers the folder-trust prompt, `close` stops it.
// The window is fully detached (its own process group, stdio ignored, unref'd).

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { STALE_DAYS, cleanUp, describe, diskBytes, findRepos, human, scanRepo } from "./worktrees.mjs";

const DEFAULT_ROOTS = (
  process.env.LAUNCH_PROJECT_ROOTS ?? `${homedir()}/development`
)
  .split(":")
  .filter(Boolean);

// Terminals this script knows how to drive, in preference order. Most accept
// a command directly; cosmic-term does not expose `-e`, so it needs the
// SHELL-wrapper trick below.
export const TERMINALS = [
  {
    bin: "cosmic-term",
    needsWrapper: true,
    args: (dir) => ["-w", dir],
  },
  {
    bin: "kitty",
    needsWrapper: false,
    args: (dir, cmd) => ["--directory", dir, ...cmd],
  },
  {
    bin: "alacritty",
    needsWrapper: false,
    args: (dir, cmd) => ["--working-directory", dir, "-e", ...cmd],
  },
  {
    bin: "konsole",
    needsWrapper: false,
    args: (dir, cmd) => ["--workdir", dir, "-e", ...cmd],
  },
  {
    bin: "gnome-terminal",
    needsWrapper: false,
    args: (dir, cmd) => [`--working-directory=${dir}`, "--", ...cmd],
  },
  {
    bin: "xterm",
    needsWrapper: false,
    args: (dir, cmd) => ["-e", `cd ${shQuote(dir)} && ${cmd.join(" ")}`],
  },
];

export function shQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function which(bin) {
  return spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0;
}

/**
 * Resolve a project argument to a directory. Accepts an absolute path, a
 * path relative to one of `LAUNCH_PROJECT_ROOTS` (default `~/development`),
 * or just a directory name, matched case-insensitively under those roots so
 * naming drift (`ThunderForgeVtt` vs `ThunderForgeVTT`) doesn't matter.
 */
const SEARCH_DEPTH = 2;

/** Case-insensitive search for `name` among directories under `dir`, up to `depth` levels deep. */
export function findCaseInsensitive(dir, name, depth) {
  if (!existsSync(dir)) return undefined;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));

  const hit = dirs.find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (hit) return join(dir, hit.name);

  if (depth > 1) {
    for (const entry of dirs) {
      const found = findCaseInsensitive(join(dir, entry.name), name, depth - 1);
      if (found) return found;
    }
  }
  return undefined;
}

export function resolveProject(input, roots = DEFAULT_ROOTS) {
  if (isAbsolute(input) && existsSync(input)) return input;

  for (const root of roots) {
    const direct = resolve(root, input);
    if (existsSync(direct)) return direct;

    const found = findCaseInsensitive(root, input, SEARCH_DEPTH);
    if (found) return found;
  }

  const cwdRelative = resolve(input);
  if (existsSync(cwdRelative)) return cwdRelative;

  throw new Error(
    `could not find project "${input}" under: ${roots.join(", ")} (set LAUNCH_PROJECT_ROOTS to add more)`,
  );
}

export function pickTerminal(terminals = TERMINALS) {
  const terminal = terminals.find((t) => which(t.bin));
  if (!terminal) {
    throw new Error(
      `no supported terminal found on PATH (tried: ${terminals.map((t) => t.bin).join(", ")})`,
    );
  }
  return terminal;
}

export function parseArgs(argv) {
  const [projectArg, ...rest] = argv;
  const opts = { sessionName: undefined };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--session-name") opts.sessionName = rest[++i];
    else if (rest[i] === "--prompt-file") opts.promptFile = rest[++i];
    else if (rest[i] === "--force") opts.force = true;
    else if (rest[i] === "--prune") opts.prune = true;
  }
  return { projectArg, opts };
}

/**
 * Whether Claude Code has been told to trust `dir` itself. Trusting a parent
 * doesn't count: the folder still opens on the trust prompt (checked on
 * Claude Code 2.x), and a brief waits behind it.
 */
export function isTrusted(dir, config = readClaudeConfig()) {
  return Boolean(config?.projects?.[resolve(dir)]?.hasTrustDialogAccepted);
}

function readClaudeConfig() {
  try {
    return JSON.parse(readFileSync(join(homedir(), ".claude.json"), "utf8"));
  } catch {
    return null;
  }
}

/** The claude command line: Remote Control on, and the brief (if any) as its first prompt. */
export function claudeCommand({ sessionName, prompt } = {}) {
  const cmd = ["claude", sessionName ? `--remote-control=${sessionName}` : "--remote-control"];
  if (prompt?.trim()) cmd.push(prompt);
  return cmd;
}

// ---------------------------------------------------------------------------
// tmux-backed sessions: launch, list, trust, close
// ---------------------------------------------------------------------------

/** Marks a tmux session as one this script started; its value is the project dir. */
const TAG = "@launch-project";
/** The Remote Control link, saved once seen: Claude Code redraws in place, so it scrolls away. */
const URL_TAG = "@launch-project-url";

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Runs tmux, on a private server when LAUNCH_PROJECT_TMUX_SOCKET is set (tests use that). */
export function tmux(args, socket = process.env.LAUNCH_PROJECT_TMUX_SOCKET) {
  return spawnSync("tmux", [...(socket ? ["-L", socket] : []), ...args], { encoding: "utf8" });
}

function tmuxPrefix(socket = process.env.LAUNCH_PROJECT_TMUX_SOCKET) {
  return ["tmux", ...(socket ? ["-L", socket] : [])];
}

/** A tmux- and Remote-Control-safe session name: the given name, or the folder's. */
export function sessionBaseName(sessionName, dir) {
  const raw = sessionName || basename(dir);
  return raw.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "session";
}

/** `base`, or `base-2`, `base-3`… when that name is taken. */
export function uniqueName(base, taken) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

const ESC = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** A line's visible text, skipping what's drawn dim (SGR 2): placeholders and hints. */
export function brightText(rawLine) {
  let dim = false;
  let out = "";
  for (const tok of rawLine.match(/\x1b\[[0-9;?]*[A-Za-z]|[^\x1b]/gu) ?? []) {
    const sgr = tok.match(/^\x1b\[([0-9;]*)m$/);
    if (sgr) {
      for (const code of sgr[1].split(";")) {
        if (code === "2") dim = true;
        else if (code === "" || code === "0" || code === "22") dim = false;
      }
    } else if (!tok.startsWith("\x1b") && !dim) out += tok;
  }
  return out;
}

/**
 * What a Claude Code screen shows: the trust prompt, a Remote Control link,
 * and any text typed into the input box but not sent. Pass the screen with
 * its escape codes (capture-pane -e). The input box is the `❯` line just
 * below a horizontal rule (dialog choices also start with `❯`, but not under
 * a rule), and its placeholder is drawn dim, so only bright text counts.
 */
export function parseScreen(raw) {
  const rawLines = raw.split("\n");
  const lines = rawLines.map((l) => l.replace(ESC, ""));
  const text = lines.join("\n");
  const trustPrompt = /Yes, I trust this folder/.test(text) && /Enter to confirm/.test(text);
  let unsent = "";
  for (let i = 1; i < lines.length; i++) {
    if (/^\s*❯/.test(lines[i]) && /^\s*─{10,}/.test(lines[i - 1])) {
      unsent = brightText(rawLines[i]).replace(/^\s*❯\s?/, "").trim();
    }
  }
  const url = [...text.matchAll(/https:\/\/claude\.ai\/code\/session_[A-Za-z0-9]+/g)].at(-1)?.[0];
  return { trustPrompt, unsent: trustPrompt ? "" : unsent, url };
}

/** Whether argv is a `claude --remote-control` command, and its session name. */
export function parseClaudeArgv(argv) {
  if (basename(argv[0] ?? "") !== "claude") return null;
  const flag = argv.find((a) => a === "--remote-control" || a.startsWith("--remote-control="));
  if (!flag) return null;
  return { name: flag.includes("=") ? flag.slice(flag.indexOf("=") + 1) : undefined };
}

function screen(name, history = false) {
  const r = tmux(["capture-pane", "-p", "-e", "-J", ...(history ? ["-S", "-2000"] : []), "-t", `=${name}:`]);
  return r.status === 0 ? r.stdout : "";
}

function elapsed(pid) {
  const r = spawnSync("ps", ["-o", "etimes=", "-p", String(pid)], { encoding: "utf8" });
  const secs = Number.parseInt(r.stdout, 10);
  if (!Number.isFinite(secs)) return undefined;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}

/**
 * Running sessions: the tmux sessions this script launched, plus any other
 * `claude --remote-control` process (started in a plain window, so its screen
 * can't be read).
 */
export function listSessions() {
  const sessions = [];
  // Every tmux pane, so a claude started in tmux by hand still counts as readable.
  const panes = new Map();
  const r = tmux(["list-panes", "-a", "-F", `#{pane_pid}\t#{session_name}\t#{${TAG}}\t#{${URL_TAG}}`]);
  if (r.status === 0) {
    for (const line of r.stdout.trim().split("\n").filter(Boolean)) {
      const [pid, name, dir, url] = line.split("\t");
      panes.set(Number(pid), name);
      if (dir) sessions.push({ kind: "tmux", name, dir, pid: Number(pid), url: url || undefined });
    }
  }
  const tmuxPids = new Set(sessions.map((s) => s.pid));
  let pids = [];
  try {
    pids = readdirSync("/proc").filter((d) => /^\d+$/.test(d)).map(Number);
  } catch {}
  for (const pid of pids) {
    if (tmuxPids.has(pid)) continue;
    let argv, dir;
    try {
      argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
      dir = readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      continue;
    }
    const claude = parseClaudeArgv(argv);
    if (!claude) continue;
    if (panes.has(pid)) sessions.push({ kind: "tmux", name: panes.get(pid), dir, pid });
    else sessions.push({ kind: "window", name: claude.name ?? `pid-${pid}`, dir, pid });
  }
  return sessions;
}

/** What a session is doing, as far as its screen shows. */
export function describeSession(s) {
  const info = { ...s, age: elapsed(s.pid) };
  if (s.kind !== "tmux") return { ...info, state: "running in a plain window (screen not readable)" };
  const now = parseScreen(screen(s.name));
  return {
    ...info,
    state: now.trustPrompt ? "waiting on the trust prompt" : "running",
    unsent: now.unsent,
    url: parseScreen(screen(s.name, true)).url ?? s.url,
  };
}

/** Uncommitted changes and commits on no remote, or null outside a git repo. */
export function gitState(dir) {
  const git = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  const status = git("status", "--porcelain");
  if (status.status !== 0) return null;
  const dirty = status.stdout.split("\n").filter(Boolean).length;
  const hasRemote = git("remote").stdout.trim() !== "";
  const unpushed = hasRemote ? Number.parseInt(git("rev-list", "--count", "HEAD", "--not", "--remotes").stdout, 10) || 0 : null;
  return { dirty, unpushed, hasRemote };
}

/** Running compose containers whose project lives in `dir`. Empty when docker isn't there. */
export function composeContainers(dir) {
  const r = spawnSync("docker", ["ps", "--format", '{{.Names}}\t{{.Label "com.docker.compose.project.working_dir"}}'], {
    encoding: "utf8",
  });
  if (r.status !== 0) return [];
  return r.stdout
    .split("\n")
    .map((l) => l.split("\t"))
    .filter(([name, wd]) => name && wd && (wd === dir || wd.startsWith(`${dir}/`)))
    .map(([name]) => name);
}

/**
 * What closing would throw away or leave behind. `blockers` stop a close
 * without --force (unsent input is lost; unfinished git work is the session's
 * to finish); `leftovers` stay running and are only reported.
 */
export function closeReport({ unsent, git, containers }) {
  const blockers = [];
  if (unsent) blockers.push(`unsent input: "${unsent}"`);
  if (git?.dirty) blockers.push(`${git.dirty} uncommitted change${git.dirty === 1 ? "" : "s"}`);
  if (git?.unpushed) blockers.push(`${git.unpushed} commit${git.unpushed === 1 ? "" : "s"} not on any remote`);
  const leftovers = containers.length ? [`containers still running (not removed): ${containers.join(", ")}`] : [];
  return { blockers, leftovers };
}

export function findSession(sessions, key) {
  return sessions.find((s) => s.name === key || String(s.pid) === key);
}

function stop(s) {
  if (s.kind === "tmux") tmux(["kill-session", "-t", `=${s.name}`]);
  else {
    try {
      process.kill(s.pid, "SIGTERM");
    } catch {}
  }
  for (let i = 0; i < 20; i++) {
    try {
      process.kill(s.pid, 0);
    } catch {
      return true;
    }
    sleep(250);
  }
  return false;
}

/** Closes a session; refuses (returns the report) when there are blockers and no `force`. */
export function closeSession(key, { force = false, sessions = listSessions() } = {}) {
  const s = findSession(sessions, key);
  if (!s) throw new Error(`no launched session named "${key}" (see: launch.mjs list)`);
  const d = describeSession(s);
  const report = closeReport({ unsent: d.unsent, git: gitState(s.dir), containers: composeContainers(s.dir) });
  if (report.blockers.length && !force) return { closed: false, session: d, ...report };
  const closed = stop(s);
  return { closed, session: d, ...report, worktree: closed ? closeWorktree(s.dir) : undefined };
}

/**
 * After a session closes, tidy its repo's worktrees: remove the session's own
 * worktree and any other unused one whose work is merged (and its merged
 * branch), and drop registrations whose folder is gone. Clean worktrees that
 * are merely idle are only suggested. Returns one line per thing done or kept.
 */
export function closeWorktree(dir) {
  const all = scanRepo(dir);
  if (!all) return undefined;
  const repo = all[0].path;
  const own = all.find((w) => !w.main && (dir === w.path || dir.startsWith(`${w.path}/`)));
  const lines = [];
  let freed = 0;
  let pruned = false;
  for (const wt of all.filter((w) => !w.main)) {
    const merged = wt.action === "remove+branch" || (wt.action === "remove" && /^merged/.test(wt.reason));
    if (wt.action === "prune") {
      if (!pruned) cleanUp(wt);
      pruned = true;
      continue;
    }
    if (!merged) {
      if (wt === own) lines.push(`kept worktree ${wt.path}: ${wt.reason}`);
      continue;
    }
    const bytes = diskBytes(wt.path);
    const r = cleanUp(wt);
    if (r.ok) freed += bytes ?? 0;
    lines.push(r.ok ? `worktree ${wt.path} ${r.note} · freed ${human(bytes)}` : `kept worktree ${wt.path}: ${r.note}`);
  }
  if (pruned) lines.push(`pruned stale worktree registrations in ${repo}`);
  const idle = all.filter((w) => w.action === "remove");
  const idleLeft = idle.filter((w) => !/^merged/.test(w.reason));
  if (idleLeft.length) {
    lines.push(
      `note: ${idleLeft.length} clean worktree${idleLeft.length === 1 ? "" : "s"} idle ${STALE_DAYS}+ days in ${repo}; ` +
        `to remove (branches kept): node scripts/launch.mjs worktrees ${repo} --prune`,
    );
  }
  if (freed && lines.length > 1) lines.push(`freed ${human(freed)} in total`);
  return { lines };
}

/** Waits up to `ms` for a session to show its Remote Control link or the trust prompt. */
export function waitForStart(name, ms = 30000) {
  for (let t = 0; t < ms; t += 500) {
    const now = parseScreen(screen(name, true));
    if (now.url) tmux(["set-option", "-t", `=${name}:`, URL_TAG, now.url]);
    if (now.url || now.trustPrompt) return now;
    sleep(500);
  }
  return parseScreen(screen(name, true));
}

/** Accepts the trust prompt in a tmux session. Only on the user's explicit OK. */
export function acceptTrust(name) {
  if (!parseScreen(screen(name)).trustPrompt) throw new Error(`"${name}" isn't showing the trust prompt`);
  tmux(["send-keys", "-t", `=${name}:`, "Down"]);
  sleep(500);
  if (!/❯\s*Yes, I trust this folder/.test(screen(name).replace(ESC, ""))) {
    throw new Error(`couldn't select "Yes, I trust this folder" in "${name}"; nothing was confirmed`);
  }
  tmux(["send-keys", "-t", `=${name}:`, "Enter"]);
  return waitForStart(name, 30000);
}

function openWindow(dir, cmd) {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return undefined;
  let terminal;
  try {
    terminal = pickTerminal();
  } catch {
    return undefined;
  }
  let env = process.env;
  let args;
  if (terminal.needsWrapper) {
    const wrapperDir = mkdtempSync(join(tmpdir(), "launch-project-"));
    const wrapper = join(wrapperDir, "run.sh");
    writeFileSync(wrapper, `#!/bin/bash\ncd ${shQuote(dir)} || exec bash\nexec ${cmd.map(shQuote).join(" ")}\n`);
    chmodSync(wrapper, 0o755);
    env = { ...process.env, SHELL: wrapper };
    args = terminal.args(dir);
  } else {
    args = terminal.args(dir, cmd);
  }
  spawn(terminal.bin, args, { detached: true, stdio: "ignore", env }).unref();
  return terminal.bin;
}

function launch(projectArg, opts) {
  const dir = resolveProject(projectArg);
  // Read now: the launched session starts later, and the file may be a temp file.
  const prompt = opts.promptFile ? readFileSync(opts.promptFile, "utf8") : undefined;
  const brief = prompt?.trim() ? " · with brief" : "";

  if (!which("tmux")) {
    const claudeCmd = claudeCommand({ sessionName: opts.sessionName, prompt });
    const bin = openWindow(dir, claudeCmd);
    if (!bin) throw new Error("no tmux and no terminal window available to launch in");
    console.log(`launched ${bin} · ${dir} · claude --remote-control${brief}`);
    console.log("note: tmux isn't installed, so this session can't be listed, closed or have its trust prompt answered from here.");
    if (!isTrusted(dir)) {
      console.log(`note: ${dir} isn't trusted yet; the window opens on the trust prompt. Ask the user to answer it there.`);
    }
    return;
  }

  const taken = tmux(["list-sessions", "-F", "#{session_name}"]).stdout?.split("\n").filter(Boolean) ?? [];
  const name = uniqueName(sessionBaseName(opts.sessionName, dir), taken);
  const claudeCmd = claudeCommand({ sessionName: name, prompt });
  const started = tmux(["new-session", "-d", "-s", name, "-c", dir, "-x", "200", "-y", "50", ...claudeCmd]);
  if (started.status !== 0) throw new Error(`tmux couldn't start the session: ${started.stderr.trim()}`);
  tmux(["set-option", "-t", `=${name}:`, TAG, dir]);

  const bin = openWindow(dir, [...tmuxPrefix(), "attach-session", "-t", `=${name}`]);
  console.log(`launched ${name} · ${dir} · claude --remote-control=${name}${brief} · ${bin ? `window: ${bin}` : "no window"}`);
  if (!bin) console.log(`attach locally with: tmux attach -t ${name}`);

  const now = waitForStart(name);
  if (now.url) console.log(`url: ${now.url}`);
  else if (now.trustPrompt) {
    console.log(
      `note: ${dir} isn't trusted yet, so the session is on the trust prompt${brief ? " and the brief waits behind it" : ""}. ` +
        `Ask the user. With their explicit OK: node scripts/launch.mjs trust ${name}`,
    );
  } else console.log(`note: no Remote Control link yet; node scripts/launch.mjs list shows it once it's up.`);
}

function printList() {
  const sessions = listSessions().map(describeSession);
  if (!sessions.length) return console.log("no launched sessions running");
  for (const s of sessions) {
    const parts = [s.name, s.dir, s.age && `up ${s.age}`, s.state, s.unsent && `unsent input: "${s.unsent}"`, s.url];
    console.log(parts.filter(Boolean).join(" · "));
  }
}

function printWorktrees(projectArg, prune) {
  const repos = projectArg ? [resolveProject(projectArg)] : findRepos(DEFAULT_ROOTS);
  let reclaimable = 0;
  let actionable = 0;
  let freed = 0;
  let shown = 0;
  for (const repo of repos) {
    const all = scanRepo(repo);
    if (!all || (all.length < 2 && !projectArg)) continue;
    shown++;
    console.log(all[0].path);
    for (const wt of all.filter((w) => !w.main)) {
      const bytes = wt.action === "prune" ? undefined : diskBytes(wt.path);
      console.log(describe(wt, bytes));
      if (wt.action === "keep") continue;
      actionable++;
      reclaimable += bytes ?? 0;
      if (!prune) continue;
      const r = cleanUp(wt);
      console.log(`         → ${r.note}`);
      if (r.ok) freed += bytes ?? 0;
    }
  }
  if (!shown) return console.log("no linked worktrees found");
  if (prune) console.log(`freed ${human(freed)}`);
  else if (actionable) {
    console.log(`${actionable} to clean up, ${human(reclaimable)} reclaimable · run with --prune to remove them`);
  }
  else console.log("nothing to clean up");
}

const USAGE = [
  "usage: launch.mjs <project-name-or-path> [--session-name <name>] [--prompt-file <path>]",
  "       launch.mjs list",
  "       launch.mjs close <name> [--force]",
  "       launch.mjs trust <name>",
  "       launch.mjs worktrees [project] [--prune]",
].join("\n");

export function main() {
  const { projectArg, opts } = parseArgs(process.argv.slice(2));
  const target = process.argv[3];
  if (!projectArg) {
    console.error(USAGE);
    process.exit(1);
  }
  try {
    if (projectArg === "list") return printList();
    if (projectArg === "worktrees") {
      return printWorktrees(target && !target.startsWith("--") ? target : undefined, opts.prune);
    }
    if ((projectArg === "close" || projectArg === "trust") && (!target || target.startsWith("--"))) {
      console.error(USAGE);
      process.exit(1);
    }
    if (projectArg === "trust") {
      const now = acceptTrust(target);
      console.log(`trusted · ${target}${now.url ? ` · url: ${now.url}` : " · no Remote Control link yet"}`);
      return;
    }
    if (projectArg === "close") {
      const r = closeSession(target, { force: opts.force });
      for (const b of r.blockers) console.log(`${r.closed ? "left behind" : "would lose"}: ${b}`);
      for (const l of r.leftovers) console.log(`note: ${l}`);
      if (!r.closed && r.blockers.length && !opts.force) {
        console.log(`not closed: ${target}. Ask the user; to close anyway: node scripts/launch.mjs close ${target} --force`);
        process.exit(2);
      }
      console.log(r.closed ? `closed · ${target}` : `still running after SIGTERM: ${target} (pid ${r.session.pid})`);
      for (const line of r.worktree?.lines ?? []) console.log(line);
      if (!r.closed) process.exit(1);
      return;
    }
    launch(projectArg, opts);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
