# skills

Personal collection of [Agent Skills](https://agentskills.io/specification) —
portable, spec-compliant `SKILL.md` packages for Claude Code and other agents
that support the format.

## Install a skill globally

Skills here get symlinked into `~/.claude/skills/<name>`, so once installed
they're available in every project and every Claude Code session, and a
`git pull` in this repo updates them everywhere automatically.

```sh
git clone git@github.com:mbround18/skills.git
cd skills
pnpm install
pnpm run install:all              # every skill, or one: pnpm run install:<name>
```

No dependencies are actually needed — `pnpm install` is a no-op today — but
it's there so adding one later doesn't change the workflow.

## Skills

### [launch-project](skills/launch-project)

Opens a new, fully detached terminal window running `claude --remote-control`
in another project's directory — so you can fan out work across projects
without any one Claude Code session tracking, waiting on, or messaging the
others.

```sh
node skills/launch-project/scripts/launch.mjs <project-name-or-path> [--session-name <name>]
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
copy `scripts/install.mjs` from any existing skill (the governance suite
keeps every copy identical), add an `install:<name>` script to the root
`package.json`, and add a section to this README.

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
