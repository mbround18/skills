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
pnpm run install:launch-project
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

## Adding a skill

```
skills/<skill-name>/
├── SKILL.md          # required: YAML frontmatter + instructions
├── scripts/           # optional: *.mjs, no dependencies unless you need one
├── references/        # optional: docs loaded on demand
└── assets/            # optional: templates, static resources
```

Follow the [Agent Skills specification](https://agentskills.io/specification):
`name` must match the directory name, lowercase with hyphens, and
`description` should say both what the skill does and when to use it. Then
add an `install:<name>` script to the root `package.json` and a section to
this README.

## License

BSD-3-Clause — see [LICENSE](LICENSE).
