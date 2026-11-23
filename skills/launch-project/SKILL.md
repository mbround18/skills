---
name: launch-project
description: Starts "claude --remote-control" in another project's directory, in a named tmux session with a terminal window attached, so work can start there and be picked up from another device; also lists, closes, and answers the trust prompt for sessions it launched, and cleans up git worktrees that are merged or stale so disk use doesn't grow. Use when the user asks to launch, open, spin up, or start Claude/a session/a terminal for a specific project or repo ("launch claude for <project>", "open a session on <project>"), to see which launched sessions are running, to kill, close, stop, or wrap up one, or to clean up old worktrees or reclaim disk space from them. The launched session is not tracked, messaged, or waited on afterward.
license: BSD-3-Clause
compatibility: Linux with Node.js and the claude CLI on PATH. tmux enables list, close and trust; a desktop terminal (cosmic-term preferred; kitty, alacritty, konsole, gnome-terminal, or xterm) opens a window on it.
metadata:
  author: mbround18
user-invocable: true
argument-hint: "<project-name-or-path> [--session-name <name>] [--prompt-file <path>] | list | close <name> [--force] | trust <name> | worktrees [project] [--prune]"
---

# launch-project

Starts a fresh, independent Claude Code session for a project, with Remote
Control enabled so the user can pick it up from another device. It runs in a
named tmux session, with a terminal window attached when there's a desktop,
so it can be found, closed, and gotten past the trust prompt later. This
session and the launched one otherwise stay strangers.

## When to use this

- The user names a project (by directory name, not necessarily exact casing)
  and asks to launch, open, or start work there.
- The user asks which launched sessions are running, or to close, kill, stop,
  or wrap one up.
- The user wants old, merged or unused worktrees cleaned up, or disk space
  back from them.

## Commands

Paths are relative to this skill's directory (the folder holding this
SKILL.md): run from there, or give the script's absolute path.

```bash
node scripts/launch.mjs <project-name-or-path> [--session-name <name>] [--prompt-file <path>]
node scripts/launch.mjs list
node scripts/launch.mjs close <name> [--force]
node scripts/launch.mjs trust <name>
node scripts/launch.mjs worktrees [project] [--prune]
```

### Launch

- `<project-name-or-path>`: an absolute path, a path relative to a root in
  `LAUNCH_PROJECT_ROOTS` (default `~/development`), or just a directory name.
  Matching is case-insensitive, so `thunderforgevtt` resolves to
  `ThunderForgeVTT` even if the user typed the casing wrong.
- `--session-name <name>`: optional. It names both the tmux session and the
  Remote Control session; it defaults to the folder's name, with a number
  added if that's taken.
- `--prompt-file <path>`: optional. The file's text becomes the new
  session's first prompt, so it starts on a goal instead of waiting. The
  file is read at launch, so a scratch file is fine. Since this session never
  follows up, make the brief self-contained: the goal, what's already known
  (paths, conventions, decisions the user made), what counts as done, and
  which steps need the user's say-so.

It waits up to 30 seconds for the session to come up, then prints one of:

- `url: …`: the Remote Control link. Give it to the user.
- a `note:` that the folder isn't trusted yet: the session is on Claude
  Code's trust prompt, which blocks Remote Control (so the user can't answer
  it from their phone) and holds back any brief. Tell the user. Only if they
  explicitly say to trust it, run `trust <name>`.

Without tmux it falls back to a plain terminal window, which `list`, `close`
and `trust` can't see into.

### List

One line per running session: name, folder, uptime, state (running, or
waiting on the trust prompt), any text typed into its input box but not sent,
and its Remote Control link. It also shows `claude --remote-control` sessions
started elsewhere; ones in a plain window are marked as unreadable.

### Close

Stops a session (its window closes with it). Before stopping, it checks what
would be lost or left unfinished:

- text typed into the input box but not sent
- uncommitted changes in the folder
- commits that aren't on any remote

If it finds any, it doesn't close and exits 2. Show the user what it found
and ask; rerun with `--force` only on their yes. Running compose containers
from that folder are reported, never removed.

Once closed, it tidies the repo's git worktrees: the session's own worktree
and any other unused one whose work is merged are removed, with their merged
branches, and registrations whose folder is gone are dropped. A worktree it
keeps is named with the reason. Clean worktrees that are only idle are
suggested for `worktrees --prune`, not removed.

### Worktrees

Lists every linked worktree, under one project or every repo under
`LAUNCH_PROJECT_ROOTS`, with its size and a verdict:

- **remove**: nothing is running in it, nothing is uncommitted, no ignored
  files that can't be rebuilt, and either its work is merged into the default
  branch (the branch is deleted too) or it's been idle for
  `LAUNCH_PROJECT_STALE_DAYS` (default 14) days (the branch is kept, so no
  commits are lost).
- **prune**: the folder is already gone; only git's registration is left.
- **keep**: anything else, with the reason: in use (and by what), locked,
  uncommitted changes, unmerged and recent, or ignored files such as `.env`
  that a build wouldn't recreate. Build output (`node_modules`, `target`,
  `dist`, caches) doesn't count as worth keeping.

`--prune` carries the verdicts out using only git's safe forms: `git worktree
remove` without `--force` and `git branch -d`, so git itself refuses anything
that changed since the scan. It prints what it freed.

### Trust

Accepts the trust prompt ("Yes, I trust this folder") in a launched session.
It checks the prompt is showing and the right choice is selected before
confirming, then prints the Remote Control link once it's up.

## Rules for the calling agent

1. Run the script with a plain `Bash` call, not the `Agent` tool: this is
   an OS-level launch, not a subagent.
2. Don't poll, message, or watch the launched session afterwards. Launch
   already waits for it to come up. Use `list` and `close` when the user asks
   about sessions, not to babysit one.
3. Never run `trust` or `close --force` on your own judgment. Trusting a
   folder lets Claude Code run code in it, and `--force` throws away unsent
   input; both need the user's explicit OK in this conversation.
4. Run `worktrees --prune` when the user has asked for cleanup. Otherwise run
   `worktrees` without it and show them what it would remove. Never delete a
   worktree it keeps by any other means (`rm -rf`, `git worktree remove
   --force`, `git branch -D`); report the reason instead.
5. If the project name is ambiguous or not found, say so and ask rather than
   guessing at a path.

## Example

```bash
node scripts/launch.mjs ThunderForgeVtt --prompt-file /tmp/brief.md
# launched ThunderForgeVTT · /home/user/development/thunderforge/ThunderForgeVTT · claude --remote-control=ThunderForgeVTT · with brief · window: cosmic-term
# url: https://claude.ai/code/session_…

node scripts/launch.mjs close ThunderForgeVTT
# would lose: 2 uncommitted changes
# not closed: ThunderForgeVTT. Ask the user; to close anyway: node scripts/launch.mjs close ThunderForgeVTT --force
```
