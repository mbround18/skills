---
name: launch-project
description: Opens a new detached terminal window running "claude --remote-control" in another project's directory, so work can start there and be picked up from another device. Use when the user asks to launch, open, spin up, or start Claude/a session/a terminal for a specific project or repo, especially phrases like "launch claude for <project>" or "open a session on <project>". The launched session is intentionally not tracked, messaged, or waited on afterward.
license: BSD-3-Clause
compatibility: Linux desktop with a terminal emulator (cosmic-term preferred; kitty, alacritty, konsole, gnome-terminal, or xterm as fallback), Node.js, and the claude CLI on PATH.
metadata:
  author: mbround18
user-invocable: true
argument-hint: "<project-name-or-path> [--session-name <name>]"
---

# launch-project

Starts a fresh, independent Claude Code session for a project, in its own
terminal window, with Remote Control enabled so the user can pick it up from
another device. This session and the launched one are meant to stay
strangers to each other.

## When to use this

The user names a project (by directory name, not necessarily exact casing)
and asks to launch, open, or start work there — usually because they want to
switch to it themselves, or want several projects going in parallel without
this session babysitting all of them.

## How to run it

```bash
node scripts/launch.mjs <project-name-or-path> [--session-name <name>]
```

- `<project-name-or-path>` — an absolute path, a path relative to a root in
  `LAUNCH_PROJECT_ROOTS` (default `~/development`), or just a directory name.
  Matching is case-insensitive, so `thunderforgevtt` resolves to
  `ThunderForgeVTT` even if the user typed the casing wrong.
- `--session-name <name>` — optional; passed through as the Remote Control
  session name. Omit it and Claude auto-names the session from the hostname.

The script resolves the directory, picks the first available terminal
emulator from its supported list, opens it there running
`claude --remote-control`, and returns immediately. It does not wait for the
terminal, the shell inside it, or Claude to do anything.

## Rules for the calling agent

1. Run the script with a plain `Bash` call, not the `Agent` tool — this is a
   fire-and-forget OS-level launch, not a subagent.
2. Do not poll, message, or watch the new session afterward. If you want to
   confirm it came up, one `ListAgents` call right after launch is enough
   (Remote Control sessions show up there once connected) — do that at most
   once, then stop. Never treat the new session as something this one is
   responsible for.
3. If the project name is ambiguous or not found, say so and ask rather than
   guessing at a path.

## Example

```bash
node scripts/launch.mjs ThunderForgeVtt
# launched cosmic-term · /home/user/development/thunderforge/ThunderForgeVTT · claude --remote-control
```
