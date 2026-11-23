# launch-project

A Claude Code [Agent Skill](https://agentskills.io/specification) that starts
`claude --remote-control` in another project's directory, in a named tmux
session with a terminal window attached. You can fan work out across several
projects, pick any of them up from your phone, and close them when they're
done, without any one Claude Code session babysitting the others.

## What it does

Ask Claude something like "launch claude for ThunderForgeVTT" and it will:

1. Resolve the project by name (case-insensitive, so `ThunderForgeVtt` still
   finds `ThunderForgeVTT`) or by an explicit path.
2. Start `claude --remote-control=<name>` there in a tmux session of the same
   name, optionally with a brief as its first prompt, and open a terminal
   window on it (cosmic-term, kitty, alacritty, konsole, gnome-terminal, or
   xterm).
3. Wait for it to come up and hand back the Remote Control link. If the
   folder has never been trusted, it tells you the session is on Claude
   Code's trust prompt instead, which blocks Remote Control until answered.

It also manages what it launched:

- "which sessions are running?": lists them with uptime, state, unsent
  input and link.
- "trust it": answers the trust prompt for you, so a session you launched
  from your phone can actually connect. Claude only does this when you say so.
- "close the offroad session": stops it, but first checks for text typed and
  never sent, uncommitted changes and unpushed commits, and asks before
  throwing those away. Leftover containers are reported, not removed. Then it
  tidies the repo's git worktrees: the session's own and any other unused
  one whose work is merged are removed, with their merged branches.
- "clean up old worktrees": lists every worktree with its size and a
  verdict, and removes the ones that are merged, or clean and idle for two
  weeks (branch kept). Anything with uncommitted changes, something running
  in it, or an ignored file a build wouldn't recreate (like `.env`) stays,
  and it says why.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/mbround18/skills/main/install.sh | bash -s -- launch-project
```

This clones the repo into `~/.local/share/agent-skills` and links the skill
into `~/.claude/skills/launch-project`; run it again to update. From a checkout of this
repo, `node scripts/install.mjs launch-project` links your working copy instead.

## Usage

Once installed, just ask Claude to launch a project by name:

> launch claude for ThunderForgeVTT

Or run it directly:

```sh
node scripts/launch.mjs <project-name-or-path> [--session-name <name>] [--prompt-file <path>]
node scripts/launch.mjs list
node scripts/launch.mjs close <name> [--force]
node scripts/launch.mjs trust <name>
node scripts/launch.mjs worktrees [project] [--prune]
```

- `<project-name-or-path>`: an absolute path, a path relative to a root in
  `LAUNCH_PROJECT_ROOTS`, or just a directory name. Directory names are
  matched case-insensitively up to two levels deep under each root.
- `--session-name <name>`: optional; names the tmux and Remote Control
  session. Defaults to the folder's name, numbered if taken.
- `--prompt-file <path>`: optional; the file's text is the new session's
  first prompt, so it starts on a goal right away instead of waiting for you.
- `close` exits 2 without stopping anything when the session has unsent
  input or unfinished git work; `--force` closes it anyway.
- `worktrees` without `--prune` only reports. With a project it looks at that
  repo; without one, at every repo under `LAUNCH_PROJECT_ROOTS`.

Attach to a session from a terminal with `tmux attach -t <name>`.

### Configuration

- `LAUNCH_PROJECT_ROOTS` — colon-separated list of directories to search for
  projects by name. Defaults to `~/development`.
- `LAUNCH_PROJECT_STALE_DAYS`: how long a clean, unmerged worktree has to
  sit idle before `worktrees` calls it stale. Defaults to 14.

## Requirements

- Linux, with tmux for list, close and trust (without it, launch falls back
  to a plain terminal window).
- A desktop terminal emulator from the list above, for the window.
- Node.js 26+.
- The `claude` CLI on `PATH`, with Remote Control access.

## Development

```sh
pnpm test
```

Runs the skill's own test suite (`tests/*.test.mjs`) with Node's built-in
test runner — no external dependencies.

## License

BSD-3-Clause — see the repo root [LICENSE](../../LICENSE).
