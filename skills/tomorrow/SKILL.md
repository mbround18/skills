---
name: tomorrow
description: Writes or resumes ./TOMORROW.md, a repo's hand-off note for picking work back up after any break — an hour, overnight, or a week. One command does both; the note's own timestamp decides. Use when the user says they are pausing, out of usage or time, done for the day, "good pause point", "write tomorrow", "leave a note"; and when a session starts in a repo that has a TOMORROW.md, or the user says "pick up where we left off", "resume", "/tomorrow". The note records the exact state of the tree, what is uncommitted and why, what was still running, what shipped, what is owed, and the gotchas that cost time, so a fresh session is working again in ten minutes.
license: BSD-3-Clause
compatibility: Any git repository. Node.js for the snapshot script.
metadata:
  author: mbround18
user-invocable: true
argument-hint: "[write|pickup]"
---

# tomorrow

`./TOMORROW.md` is the one file a fresh session reads first. It describes
*now*, not history: it is rewritten whole at every pause and the previous
version is left to git. Time only moves forward through it — you write a
note, then later you resume from it, then you write the next one.

## Which way this call goes

Run the snapshot first, from the repo root and from any worktree that
holds uncommitted work:

```bash
node scripts/snapshot.mjs [repo-path ...]
```

Paths are relative to this skill's directory (the folder holding this
SKILL.md): run from there, or give the script's absolute path.

Its last line is the decision, made from timestamps alone:

| the note…                                       | mode     |
| ----------------------------------------------- | -------- |
| does not exist                                  | `write`  |
| exists and nothing in the tree moved since it   | `pickup` |
| exists but commits or edits came after it       | `write`  |
| is stamped in the future                        | `write`, and say a clock is wrong |

"Moved" means the HEAD commit time or a dirty file's mtime is later than
the note's stamp, beyond a 15-minute grace for committing the note itself.
An hour, a day and a week later all read the same: if the tree is as the
note left it, you are resuming. An explicit `write` or `pickup` argument
from the user overrides the decision; so do their words ("we're pausing"
is `write` whatever the clock says).

The stamp is the first line of the note, written by you at write time:

```
<!-- tomorrow: 2026-10-06T22:41:07.000Z -->
```

Use `new Date().toISOString()`, or copy the value `snapshot.mjs` shows for
`stampLine`. A note without a stamp is treated as written at the end of the
day in its "end of YYYY-MM-DD" line.

## Writing

### 1. Gather facts, do not recall them

Everything in the note about the tree comes from the snapshot output —
branch, HEAD (hash, subject, signature verdict), ahead/behind, every dirty
path, worktrees — not from memory of what you think you committed.

Then check what is still running that the note must mention: background
test runs, builds, deploys, locks a hook will refuse against. A process
that outlives the session is the thing most likely to be forgotten.

### 2. Write the file

Use `assets/TOMORROW.template.md` as the skeleton. Sections, in order,
each one dropped if genuinely empty:

1. **Stamp, title, date line** — the `<!-- tomorrow: … -->` stamp, then
   "Where X stood at the end of YYYY-MM-DD".
2. **State of the tree** — per checkout: branch, HEAD, clean or not,
   pushed or not and *why not* (awaiting go-ahead, deploys on push, hook
   refused). Every uncommitted file with one line on what it changes and
   whether it is ready to commit. Say what refused a commit if something
   did.
3. **First thing** — the exact commands and tool calls that resume work,
   in order, beginning with a check that the tree still matches this note.
   Include the verification that must pass before anyone asks the owner to
   deploy.
4. **Runs in flight** — anything still executing or whose result was not
   read: where its log is, what it had shown, what to do with each outcome.
   Say when a log lives somewhere that may be gone by morning.
5. **What shipped** — this round's landed work, a few lines each, with the
   spec or ticket and the test that proves it. Short; commits have detail.
6. **Still owed** — unfinished items, measurements not taken, questions the
   owner has not answered. Decisions-needed belong where they will be
   answered (a spec, an ADR); point at them here.
7. **Things that cost time** — this round's gotchas, one line each, so the
   reader does not pay twice. Only new ones; drop entries from the old
   note that now live in the repo's own docs or in memory.
8. **Standing constraints** — secrets locations, signing, licensing of
   fixtures, anything a wrong step makes expensive. Keep what still holds
   from the previous note; delete what no longer does.

### 3. Rules

- Facts over prose: hashes, paths, test counts, exit codes, timestamps.
- Verbatim commands. The reader pastes them.
- Uncommitted work first; it is the only state git will not protect.
- Say "not pushed" and "not deployed" explicitly when true; silence reads
  as done.
- The owner's decisions are recorded as decisions and their open questions
  as questions. Do not answer the questions for them here.
- Never a secret, token or session link. Point at where a secret lives.
- Whether the note is tracked is the repo's choice: some ignore it
  (`/TOMORROW.md` in `.gitignore`) so it stays a local scratch note, others
  commit it. Follow what the repo does; never add it to `.gitignore` or
  force-add it yourself. Where it is tracked it rides with the next commit,
  signed like anything else, and is not committed alone unless asked.

## Picking up

1. Read `./TOMORROW.md` in full before anything else.
2. The snapshot already ran; compare it with the note's "State of the
   tree". Same HEAD, same dirty files? If not, say what differs before
   acting on the note, and ask nothing — report, then proceed with what
   still holds.
3. Do the "First thing" section in order, reporting each step's outcome.
4. Resolve "Runs in flight": read what can still be read, rerun what
   cannot.
5. Only then take new work, from "Still owed" unless the user redirects.
6. At the next pause, write the note again. Never edit the old one in
   place to "update" it; a note is the state at one instant.
