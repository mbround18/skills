# AGENTS.md

Instructions for any agent (Claude or otherwise) working in this repo.

## What this repo is

A pnpm workspace of portable, [agentskills.io](https://agentskills.io/specification)
-compliant Agent Skills. The root package manages the workspace; every skill
under `skills/*` is its own workspace package.

## Required structure for every skill

`skills/<skill-name>/` must contain all of the following before it is
considered done. The root `tests/governance.test.mjs` suite enforces this
automatically — it fails the build if any skill is missing a piece.

- **`SKILL.md`** — the agent-facing spec. YAML frontmatter with `name`
  (must equal the directory name, lowercase alphanumeric with single
  hyphens, ≤64 chars) and `description` (1–1024 chars, says what the skill
  does and when to use it), per the Agent Skills specification.
- **`README.md`** — a consumer-facing readme, distinct from `SKILL.md`.
  Written for a human deciding whether to install and use the skill: what it
  does, how to install it, usage examples, requirements. This is not the
  same document as `SKILL.md` and should not just restate its frontmatter.
- **`package.json`** — a valid workspace package with a `name` and a
  `scripts.test` entry.
- **`tests/`** — at least one `*.test.mjs` file, run via `scripts.test`.
  Use Node's built-in `node:test` / `node:assert` — no test framework
  dependency.

## Conventions

- Scripts are `.mjs`. Prefer zero dependencies; reach for an npm package
  only when hand-rolling it would be worse, and add it via `pnpm add`.
- Exported, testable functions over inline `main()` logic — guard the CLI
  entrypoint behind `if (import.meta.url === \`file://${process.argv[1]}\`)`
  so scripts stay both runnable and importable by tests.
- Every commit must be GPG/SSH-signed. No `--no-gpg-sign`, no unsigned
  fallback — if signing fails, stop and tell the user.
- Never include a Claude session link or `Claude-Session:` line in anything
  committed or pushed.

## Running tests

```sh
pnpm install
pnpm test          # governance tests + every skill's own tests
```

Or individually:

```sh
node --test tests/*.test.mjs                        # root governance tests
pnpm --filter launch-project test                    # one skill's tests
```

## Adding a new skill

1. Create `skills/<name>/` with `SKILL.md`, `README.md`, `package.json`
   (with a `test` script), and `tests/` containing real tests.
2. Add an `install:<name>` script to the root `package.json`.
3. Add a section to the root `README.md`.
4. Run `pnpm test` from the root — the governance suite will catch anything
   missing.
