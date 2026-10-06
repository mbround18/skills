# tomorrow

A hand-off note for a repository, written at every pause and read at every
return. `./TOMORROW.md` says exactly where things stood — what is
uncommitted and why, what was still running, what shipped, what is owed,
and what cost time — so a fresh Claude Code session (or you, after a week
away) is working again in ten minutes instead of re-deriving the state from
`git log` and memory.

One command, `/tomorrow`, does both directions. The note carries a
timestamp; if nothing in the tree has moved since it was written you are
resuming, and the agent reads the note and does its "First thing" list. If
commits or edits came after it, the note is behind and gets rewritten. An
hour later, overnight, or the next week all behave the same — time only
moves forward through the file.

## Install

```sh
cd skills
pnpm run install:tomorrow        # symlinks into ~/.claude/skills/tomorrow
```

## Use

In any Claude Code session inside a git repository:

- `/tomorrow` — let the timestamp decide.
- `/tomorrow write` — you are pausing; write the note now.
- `/tomorrow pickup` — read the note and resume from it.

Or just say it: "good pause point, about to run out of usage" writes;
"pick up where we left off" resumes.

The snapshot the agent works from is a plain script you can run yourself:

```sh
node skills/tomorrow/scripts/snapshot.mjs [repo ...]
```

```
/home/you/dev/project
  branch   main
  HEAD     d6d03ec3 G Spec 078 Structures …   (G = good signature, N = unsigned)
  upstream origin/main: 38 ahead, 0 behind
  tree     clean
  worktrees
    /home/you/dev/project          d6d03ec3 [main]
    /home/you/dev/project-levels   d6d03ec3 [073-shape-and-light-menus]
  note     stamped 2026-10-06T21:41:24.000Z
  mode     pickup — nothing has moved since the note; 9 hours ago
```

Pass every worktree that holds uncommitted work; each gets its own block.

## What goes in the note

In order: the stamp and date; the state of every checkout (branch, HEAD,
dirty files one by one, pushed or not and why not); the exact commands to
resume; runs still in flight and where their logs are; what shipped this
round and the test that proves it; what is still owed, with the owner's
open questions pointed at the spec that will answer them; the gotchas that
cost time; and standing constraints (where secrets live, signing, fixture
licensing). `assets/TOMORROW.template.md` is the skeleton.

Facts over prose, verbatim commands, uncommitted work first, and never a
secret or a session link.

## Tracked or not

That is the repo's call. Some projects gitignore `/TOMORROW.md` so it stays
a private scratch note; others commit it so a teammate can pick up too. The
skill follows whichever the repo already does.

## Requirements

Node.js 18+ and git. No dependencies.

## Tests

```sh
pnpm --filter tomorrow test
```
