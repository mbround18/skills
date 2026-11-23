---
name: new-project
description: Scaffolds a new project in one of our common layouts (rust, rust-react, web) by running the upstream generators (cargo new, cargo add, pnpm init, create-vite) and adding our conventions on top - Cargo/pnpm workspaces with apps/ and crates/ or packages/, a Makefile whose build runs gc, multi-stage Docker with cargo-chef, compose with a restart policy that defaults to "no", a licence, README, CONTRIBUTING and docs/guides. Use when the user wants to start, create, bootstrap, scaffold or set up a new project, repo, app or service, e.g. "new Rust project", "start a Rust + React app", "scaffold a web app".
license: BSD-3-Clause
compatibility: Node.js and git; cargo for rust layouts, pnpm for web layouts; network access for the generators.
metadata:
  author: mbround18
user-invocable: true
argument-hint: "<name> --layout <rust|rust-react|web> [--dir <parent>] [--license <bsd-3-clause|mit|apache-2.0>] [--description <text>] [--no-docker] [--no-graphql] [--dry-run]"
---

# new-project

Creates a project folder in one of our standard layouts. The code comes from
the upstream generators, so it's always their current output and there are
no templates to maintain. This skill only adds what's ours: the workspace
layout, housekeeping, Docker, licence and docs.

## Layouts

| layout | what you get |
| --- | --- |
| `rust` | Cargo workspace: `apps/<name>` (binary, `cargo new`), `crates/<name>-core` (library) |
| `rust-react` | `rust`, plus an Axum server in `apps/<name>` that serves `apps/web` from `--static-dir` / `STATIC_DIR`, a pnpm workspace with `apps/web` (create-vite `react-ts`) and `packages/core`, and a GraphQL contract (below) |
| `web` | pnpm workspace: `apps/web` (create-vite `react-ts`) and `packages/core` |

Every layout also gets:
- `git init` on `main`
- `.gitignore`, a `LICENSE` (BSD-3-Clause by default), `README.md` with the Discord link, `CONTRIBUTING.md` and `docs/guides/`
- a `Makefile` with `build` (which runs `gc` first), `check`, `test` and `gc`. `gc` runs `cargo sweep` and caps the Docker build cache, and never fails the build.
- unless `--no-docker`: a multi-stage `Dockerfile` (cargo-chef for Rust, `pnpm fetch` for the web app, assets copied beside the binary, never embedded), `.dockerignore`, and `compose.yaml` with `restart: ${RESTART_POLICY:-no}`

### The GraphQL contract (`rust-react`, unless `--no-graphql`)

One schema both sides work from, defined once in Rust:

- `crates/<name>-contract`: the schema in async-graphql, without default
  features or I/O so it compiles to WASM. `make check` proves that when the
  `wasm32-unknown-unknown` target is installed, and says how to add it when
  it isn't.
- The server serves it at `/graphql`.
- It's exported to `crates/<name>-contract/schema.graphql`; graphql-codegen
  (client preset) generates the frontend's types into `apps/web/src/gql`
  before every `dev` and `build`. `apps/web/src/api.ts` holds a typed
  `execute()` helper and a sample `Health` query.
- A Rust test fails when `schema.graphql` falls behind the Rust schema.
  `make schema` re-exports it and regenerates the types.

## Commands

Paths are relative to this skill's directory (the folder holding this
SKILL.md): run from there, or give the script's absolute path.

```bash
node scripts/new.mjs <name> --layout <rust|rust-react|web> [--dir <parent>] [--license <bsd-3-clause|mit|apache-2.0>] [--description <text>] [--no-docker] [--no-graphql] [--dry-run]
```

- `<name>`: lowercase letters, digits and single hyphens. It becomes the
  folder, the binary and the package scope.
- `--dir`: the parent folder. Defaults to `NEW_PROJECT_ROOT`, else `~/development`.
- `--dry-run`: prints every command and file it would run or write, and touches nothing.

It refuses a folder that already exists and isn't empty. If a generator fails
(often no network), it stops, says which step failed, and leaves the partial
folder to look at.

## Rules for the calling agent

1. If the user didn't say which layout, ask: name the three with one line each.
   Don't guess between `rust` and `rust-react`.
2. Ask before scaffolding into a folder the user didn't name, and never
   delete an existing one to make room.
3. After it finishes, run `make check` in the new project and report the result.
4. The script never commits. Make the first commit signed, through the gitops
   `commit` tool when it's available (else `git commit -S`). If signing fails,
   stop and ask the user. Never commit unsigned.
5. It doesn't create a remote or push. Offer to, and do it only on the
   user's yes.
6. To start work there, offer the launch-project skill with a brief.

## Not included yet

- OpenTelemetry wiring, Playwright, and database/NATS/Redis services in compose

Add these per project for now. Say so when the user expects them.

## Example

```bash
node scripts/new.mjs trail-log --layout rust-react --description "Logs trail runs"
# creating /home/user/development/trail-log (rust-react)
#   run    git init -q -b main
#   …
# done: /home/user/development/trail-log
# next: make check, then make the first commit (signed)
```
