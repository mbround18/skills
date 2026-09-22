# launch-project

A Claude Code [Agent Skill](https://agentskills.io/specification) that opens
a new, fully detached terminal window running `claude --remote-control` in
another project's directory — so you can fan out work across several
projects without any one Claude Code session tracking, polling, or messaging
the others.

## What it does

Ask Claude something like "launch claude for ThunderForgeVTT" and it will:

1. Resolve the project by name (case-insensitive, so typos in casing like
   `ThunderForgeVtt` still find `ThunderForgeVTT`) or by an explicit path.
2. Pick the first available terminal emulator on your system
   (cosmic-term, kitty, alacritty, konsole, gnome-terminal, or xterm).
3. Open that terminal in the project's directory running
   `claude --remote-control`, so you can pick the session up later from
   another device.
4. Return immediately — the calling session does not wait for, poll, or
   message the new one. They stay strangers to each other.

## Install

From the repo root:

```sh
pnpm install
pnpm run install:launch-project
```

This symlinks `skills/launch-project` into `~/.claude/skills/launch-project`,
so it's available in every Claude Code session on this machine. Because it's
a symlink, `git pull` in this repo updates the installed skill automatically
— no reinstall needed after an update.

## Usage

Once installed, just ask Claude to launch a project by name:

> launch claude for ThunderForgeVTT

Or run it directly:

```sh
node scripts/launch.mjs <project-name-or-path> [--session-name <name>]
```

- `<project-name-or-path>` — an absolute path, a path relative to a root in
  `LAUNCH_PROJECT_ROOTS`, or just a directory name. Directory names are
  matched case-insensitively up to two levels deep under each root.
- `--session-name <name>` — optional; passed through as the Remote Control
  session name. Omit it and Claude names the session from the hostname.

### Configuration

- `LAUNCH_PROJECT_ROOTS` — colon-separated list of directories to search for
  projects by name. Defaults to `~/development`.

## Requirements

- Linux desktop with one of the supported terminal emulators.
- Node.js 18+.
- The `claude` CLI on `PATH`, with Remote Control access.

## Development

```sh
pnpm test
```

Runs the skill's own test suite (`tests/*.test.mjs`) with Node's built-in
test runner — no external dependencies.

## License

BSD-3-Clause — see the repo root [LICENSE](../../LICENSE).
