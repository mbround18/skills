# new-project

Start a new project in one of our standard layouts in one command: a Rust
workspace, a Rust server with a React + TypeScript frontend, or a React app.

The code comes from the upstream generators (`cargo new`, `cargo add`,
`pnpm init`, `create-vite`), so it's always current and there are no
templates of ours to fall behind. On top, it adds our conventions:

- workspaces: entry points in `apps/`, libraries in `crates/` and `packages/`
- a `Makefile` whose `build` also clears old `target/` output and the Docker
  build cache, so disk use doesn't creep up
- a multi-stage `Dockerfile` (cargo-chef caching, frontend assets served
  from disk) and a `compose.yaml` that doesn't auto-restart on a dev box
- a licence, a short README, a detailed CONTRIBUTING and `docs/guides/`

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/mbround18/skills/main/install.sh | bash -s -- new-project
```

This clones the repo into `~/.local/share/agent-skills` and links the skill
into `~/.claude/skills/new-project`; run it again to update. From a checkout of this
repo, `node scripts/install.mjs new-project` links your working copy instead.

## Use

Ask your agent: "start a new Rust + React project called trail-log". Or run it
yourself:

```sh
node scripts/new.mjs trail-log --layout rust-react
node scripts/new.mjs ingest --layout rust --license mit
node scripts/new.mjs landing --layout web --no-docker --dir ~/sites
node scripts/new.mjs ingest --layout rust --dry-run   # see what it would do
```

Layouts:

- `rust`: `apps/<name>` binary and `crates/<name>-core` library.
- `rust-react`: the same, with an Axum server that serves the Vite React app
  from `apps/web` (path set by `--static-dir` / `STATIC_DIR`), and
  `packages/core` for shared TypeScript.
- `web`: the Vite React app and `packages/core`.

Then `make check` to lint, build and test it, and commit.

## Requirements

- Node.js and git
- cargo for `rust` and `rust-react`, pnpm for `rust-react` and `web`
- network access, for the generators to fetch their latest versions

## Configuration

- `NEW_PROJECT_ROOT`: where new projects go when `--dir` isn't given.
  Defaults to `~/development`.
