#!/usr/bin/env node
// Opens a new terminal window running `claude --remote-control` in a project
// directory, then exits. The spawned terminal is fully detached (its own
// process group, stdio ignored, unref'd) — this process, and whatever called
// it, never track or wait on the session it starts.

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const DEFAULT_ROOTS = (
  process.env.LAUNCH_PROJECT_ROOTS ?? `${homedir()}/development`
)
  .split(":")
  .filter(Boolean);

// Terminals this script knows how to drive, in preference order. Most accept
// a command directly; cosmic-term does not expose `-e`, so it needs the
// SHELL-wrapper trick below.
const TERMINALS = [
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

function shQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function which(bin) {
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
function findCaseInsensitive(dir, name, depth) {
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

function resolveProject(input) {
  if (isAbsolute(input) && existsSync(input)) return input;

  for (const root of DEFAULT_ROOTS) {
    const direct = resolve(root, input);
    if (existsSync(direct)) return direct;

    const found = findCaseInsensitive(root, input, SEARCH_DEPTH);
    if (found) return found;
  }

  const cwdRelative = resolve(input);
  if (existsSync(cwdRelative)) return cwdRelative;

  throw new Error(
    `could not find project "${input}" under: ${DEFAULT_ROOTS.join(", ")} (set LAUNCH_PROJECT_ROOTS to add more)`,
  );
}

function pickTerminal() {
  const terminal = TERMINALS.find((t) => which(t.bin));
  if (!terminal) {
    throw new Error(
      `no supported terminal found on PATH (tried: ${TERMINALS.map((t) => t.bin).join(", ")})`,
    );
  }
  return terminal;
}

function parseArgs(argv) {
  const [projectArg, ...rest] = argv;
  const opts = { sessionName: undefined };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--session-name") opts.sessionName = rest[++i];
  }
  return { projectArg, opts };
}

function main() {
  const { projectArg, opts } = parseArgs(process.argv.slice(2));
  if (!projectArg) {
    console.error("usage: launch.mjs <project-name-or-path> [--session-name <name>]");
    process.exit(1);
  }

  const dir = resolveProject(projectArg);
  const claudeCmd = [
    "claude",
    opts.sessionName ? `--remote-control=${opts.sessionName}` : "--remote-control",
  ];
  const terminal = pickTerminal();

  let env = process.env;
  let args;
  if (terminal.needsWrapper) {
    const wrapperDir = mkdtempSync(join(tmpdir(), "launch-project-"));
    const wrapper = join(wrapperDir, "run.sh");
    writeFileSync(
      wrapper,
      `#!/bin/bash\ncd ${shQuote(dir)} || exec bash\nexec ${claudeCmd.join(" ")}\n`,
    );
    chmodSync(wrapper, 0o755);
    env = { ...process.env, SHELL: wrapper };
    args = terminal.args(dir);
  } else {
    args = terminal.args(dir, claudeCmd);
  }

  const child = spawn(terminal.bin, args, {
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();

  console.log(`launched ${terminal.bin} · ${dir} · claude --remote-control`);
}

main();
