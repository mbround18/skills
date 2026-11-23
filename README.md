# skills

Personal collection of [Agent Skills](https://agentskills.io/specification) —
portable, spec-compliant `SKILL.md` packages for Claude Code and other agents
that support the format.

## Install a skill globally

One line, no manual clone (needs git and Node.js 26+):

```sh
curl -fsSL https://raw.githubusercontent.com/mbround18/skills/main/install.sh | bash -s -- pwa pdf-parse   # one or more skills
curl -fsSL https://raw.githubusercontent.com/mbround18/skills/main/install.sh | bash -s -- --all           # every skill
curl -fsSL https://raw.githubusercontent.com/mbround18/skills/main/install.sh | bash -s -- --list          # what's available
```

It keeps a shallow clone in `~/.local/share/agent-skills` (`SKILLS_HOME`)
and symlinks each skill into `~/.claude/skills/<name>` (`CLAUDE_SKILLS_DIR`),
so the skills are available in every project and session. Run it again to
update. `SKILLS_BRANCH` picks another branch.

From a checkout of this repo, the same installer links to your working copy,
so `git pull` updates the installed skills:

```sh
node scripts/install.mjs pwa      # or --all, --list, --target <dir>
```

## Skills

### [launch-project](skills/launch-project)

Starts `claude --remote-control` in another project's directory, in a named
tmux session with a terminal window on it, and hands back the Remote Control
link. You can fan work out across projects and pick it up from your phone.
It can also list the sessions it launched, answer a new folder's trust prompt
(which otherwise blocks Remote Control), and close a session once it has
checked for unsent input and unpushed work. Closing also removes merged git
worktrees, and `worktrees --prune` clears merged or long-idle ones across
your repos, so checkouts and their build output don't keep eating disk.

```sh
node skills/launch-project/scripts/launch.mjs <project-name-or-path> [--session-name <name>] [--prompt-file <path>]
node skills/launch-project/scripts/launch.mjs list | close <name> [--force] | trust <name> | worktrees [project] [--prune]
```

Matches project directory names case-insensitively under `~/development` (or
`LAUNCH_PROJECT_ROOTS`, colon-separated), so typos in casing don't matter.
Supports cosmic-term, kitty, alacritty, konsole, gnome-terminal, and xterm.

### [pdf-parse](skills/pdf-parse)

Turns any text PDF into clean Markdown with real heading levels and page
markers, plus heading-aware JSONL chunks (section path, page span, citation
line) ready for embeddings, RAG or an agent to read. Running headers, page
numbers and footnotes are separated out; no per-publisher rules.

```sh
node skills/pdf-parse/scripts/pdf-parse.mjs report.pdf [--pages 10-42] [--out dir]
```

### [pwa](skills/pwa)

Turns any existing web frontend, in any framework or none, into a solid
Progressive Web App. It gives the driving factors to decide by, a tiered
checklist (minimum → fully compatible → robust), dependency-free templates
(manifest, service worker, update-aware registration, offline page) and an
audit of built output that reports each frontend's tier and can gate CI.
Condensed from MDN's PWA guides.

```sh
node skills/pwa/scripts/audit.mjs dist [more-dist ...] [--require compatible] [--json]
```

### [tomorrow](skills/tomorrow)

Writes or resumes `./TOMORROW.md`, a repo's hand-off note: the state of the
tree, what is uncommitted and why, what was still running, what shipped,
what is owed, and what cost time. One `/tomorrow` does both — the note's
timestamp decides whether you are pausing or returning, an hour or a week
later.

```sh
node skills/tomorrow/scripts/snapshot.mjs [repo ...]   # the facts the note is built from
```

## Adding a skill

```
skills/<skill-name>/
├── SKILL.md          # required: YAML frontmatter + instructions
├── README.md          # required: consumer-facing readme
├── package.json       # required: workspace package with a "test" script
├── tests/              # required: at least one *.test.mjs
├── scripts/           # optional: *.mjs, no dependencies unless you need one
├── references/        # optional: docs loaded on demand
└── assets/            # optional: templates, static resources
```

Follow the [Agent Skills specification](https://agentskills.io/specification):
`name` must match the directory name, lowercase with hyphens, and
`description` should say both what the skill does and when to use it. Then
add a section to this README. No installer per skill: the root
`scripts/install.mjs` installs anything with a `SKILL.md`.

See [AGENTS.md](AGENTS.md) for the full governance checklist — the root
`tests/governance.test.mjs` suite enforces it automatically.

## Workspace and tests

This repo is a [pnpm workspace](pnpm-workspace.yaml); every skill under
`skills/*` is its own package.

```sh
pnpm install
pnpm test
```

`pnpm test` runs the root governance tests (every skill has a `SKILL.md`,
`README.md`, `package.json` with a `test` script, and its own `tests/`) and
then each skill's own test suite.

## License

BSD-3-Clause — see [LICENSE](LICENSE).
