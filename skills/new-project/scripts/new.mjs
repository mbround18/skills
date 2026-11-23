#!/usr/bin/env node
// Scaffolds a new project in one of our common layouts. The upstream
// generators write the code (cargo new, cargo add, pnpm init, create-vite),
// so it stays current with no templates of ours to maintain. On top, this
// writes only our conventions: workspace roots, Makefile with gc, Docker,
// compose, licence and docs. It never commits; the caller makes the first
// (signed) commit.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as files from "./files.mjs";

export const LAYOUTS = {
  rust: { rust: true, web: false, docker: true, about: "Cargo workspace: apps/<name> binary, crates/<name>-core library" },
  "rust-react": {
    rust: true,
    web: true,
    docker: true,
    about: "Cargo + pnpm workspaces: Axum server in apps/<name> serving the Vite React TS app in apps/web",
  },
  web: { rust: false, web: true, docker: true, about: "pnpm workspace: Vite React TS app in apps/web, shared code in packages/core" },
};

/** Cargo package names and pnpm scopes both accept this; keeping to it avoids renames later. */
export function checkName(name) {
  if (!name) return "a project name is required";
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    return `"${name}" isn't a valid name: use lowercase letters, digits and single hyphens, starting with a letter`;
  }
  if (name.length > 64) return "keep the name to 64 characters or fewer";
  return undefined;
}

/**
 * The steps that build the project, in order. Each step is one of:
 *   { run: [cmd, ...args], cwd }   run an upstream tool
 *   { write: path, content }       write one of our convention files
 *   { json: path, set, drop }      adjust a package.json a tool generated
 *   { mkdir: path }
 * Paths are relative to the project root.
 */
export function plan(opts) {
  const layout = LAYOUTS[opts.layout];
  const p = { ...opts, ...layout, docker: layout.docker && opts.docker !== false };
  const { name } = p;
  const steps = [
    { run: ["git", "init", "-q", "-b", "main"], cwd: "." },
    { write: ".gitignore", content: files.gitignore(p) },
    { write: "LICENSE", content: files.licenseText(p) },
    { write: "README.md", content: files.readme(p) },
    { write: "CONTRIBUTING.md", content: files.contributing(p) },
    { write: "docs/guides/README.md", content: files.guidesReadme(p) },
  ];

  if (p.rust) {
    steps.push(
      // Cargo reads a glob member literally until the folder exists.
      { mkdir: "apps" },
      { mkdir: "crates" },
      { write: "Cargo.toml", content: files.cargoWorkspace(p) },
      { run: ["cargo", "new", "--quiet", "--vcs", "none", "--lib", `crates/${name}-core`], cwd: "." },
      { run: ["cargo", "new", "--quiet", "--vcs", "none", `apps/${name}`], cwd: "." },
    );
    if (p.web) {
      for (const [crate, features] of [["axum"], ["tokio", "full"], ["tower-http", "fs"], ["clap", "derive,env"]]) {
        steps.push({ run: ["cargo", "add", "--quiet", "-p", name, crate, ...(features ? ["-F", features] : [])], cwd: "." });
      }
      steps.push({ write: `apps/${name}/src/main.rs`, content: files.axumMain() });
    }
  }

  if (p.web) {
    const license = files.LICENSES[p.license];
    steps.push(
      { run: ["pnpm", "init"], cwd: "." },
      {
        json: "package.json",
        set: {
          name,
          private: true,
          description: p.description ?? "",
          license,
          scripts: { build: "pnpm -r build", lint: "pnpm -r --if-present lint", test: "pnpm -r --if-present test" },
        },
        drop: ["main", "keywords", "author"],
      },
      { write: "pnpm-workspace.yaml", content: files.pnpmWorkspace() },
      {
        run: ["pnpm", "create", "vite@latest", "apps/web", "--template", "react-ts", "--no-interactive", "--no-immediate"],
        cwd: ".",
      },
      { mkdir: "packages/core" },
      { run: ["pnpm", "init"], cwd: "packages/core" },
      {
        json: "packages/core/package.json",
        set: {
          name: `@${name}/core`,
          private: true,
          license,
          types: "src/index.ts",
          exports: { ".": "./src/index.ts" },
          scripts: {},
        },
        drop: ["main", "keywords", "author", "description", "packageManager", "devEngines"],
      },
      { write: "packages/core/src/index.ts", content: files.coreIndex() },
      { run: ["pnpm", "install"], cwd: "." },
      { run: ["pnpm", "--filter", "web", "add", `@${name}/core`, "--workspace"], cwd: "." },
    );
  }

  steps.push({ write: "Makefile", content: files.makefile(p) });
  if (p.docker) {
    steps.push(
      { write: "Dockerfile", content: files.dockerfile(p) },
      { write: ".dockerignore", content: files.dockerignore() },
      { write: "compose.yaml", content: files.compose(p) },
    );
  }
  return steps;
}

export function describeStep(s) {
  if (s.run) return `run    ${s.run.join(" ")}${s.cwd && s.cwd !== "." ? `  (in ${s.cwd})` : ""}`;
  if (s.write) return `write  ${s.write}`;
  if (s.json) return `edit   ${s.json}`;
  return `mkdir  ${s.mkdir}`;
}

/** Applies a json step to an object: `set` keys replace, `drop` keys go. */
export function applyJson(obj, { set = {}, drop = [] }) {
  const out = { ...obj, ...set };
  for (const k of drop) delete out[k];
  return out;
}

/** Runs the steps under `root`. Stops at the first failure and says which step and why. */
export function execute(steps, root, { log = () => {}, env = process.env } = {}) {
  for (const s of steps) {
    if (s.run) {
      const r = spawnSync(s.run[0], s.run.slice(1), { cwd: join(root, s.cwd ?? "."), encoding: "utf8", env });
      if (r.status !== 0) {
        const why = (r.error?.message ?? `${r.stderr}\n${r.stdout}`).trim().split("\n").slice(-8).join("\n");
        return { ok: false, step: s, error: why };
      }
    } else if (s.write) {
      const path = join(root, s.write);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, s.content);
    } else if (s.json) {
      const path = join(root, s.json);
      const obj = applyJson(JSON.parse(readFileSync(path, "utf8")), s);
      writeFileSync(path, `${JSON.stringify(obj, null, 2)}\n`);
    } else if (s.mkdir) {
      mkdirSync(join(root, s.mkdir), { recursive: true });
    }
    log(describeStep(s));
  }
  return { ok: true };
}

function gitAuthor() {
  const r = spawnSync("git", ["config", "user.name"], { encoding: "utf8" });
  return r.stdout?.trim() || userInfo().username;
}

export function parseArgs(argv) {
  const opts = { license: "bsd-3-clause", docker: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--layout") opts.layout = argv[++i];
    else if (a === "--dir") opts.dir = argv[++i];
    else if (a === "--license") opts.license = argv[++i];
    else if (a === "--description") opts.description = argv[++i];
    else if (a === "--no-docker") opts.docker = false;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--help" || a === "-h") opts.help = true;
    else if (a.startsWith("-")) opts.unknown = a;
    else opts.name = a;
  }
  return opts;
}

const USAGE = `usage: new.mjs <name> --layout <${Object.keys(LAYOUTS).join("|")}> [--dir <parent>] [--license <${Object.keys(files.LICENSES).join("|")}>] [--description <text>] [--no-docker] [--dry-run]

layouts:
${Object.entries(LAYOUTS)
  .map(([k, v]) => `  ${k.padEnd(11)} ${v.about}`)
  .join("\n")}`;

/** Checks everything that can be checked before touching the disk. Returns an error string or undefined. */
export function validate(opts, target) {
  if (opts.unknown) return `unknown option ${opts.unknown}`;
  const bad = checkName(opts.name);
  if (bad) return bad;
  if (!LAYOUTS[opts.layout]) return `pick a layout with --layout: ${Object.keys(LAYOUTS).join(", ")}`;
  if (!files.LICENSES[opts.license]) return `unknown licence ${opts.license}: ${Object.keys(files.LICENSES).join(", ")}`;
  if (existsSync(target) && readdirSync(target).length) return `${target} already exists and isn't empty`;
  return undefined;
}

export function missingTools(opts) {
  const need = ["git", LAYOUTS[opts.layout]?.rust && "cargo", LAYOUTS[opts.layout]?.web && "pnpm"].filter(Boolean);
  return need.filter((t) => spawnSync(t, ["--version"], { encoding: "utf8" }).status !== 0);
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) return console.log(USAGE);
  const parent = resolve(opts.dir ?? process.env.NEW_PROJECT_ROOT ?? join(homedir(), "development"));
  const target = join(parent, opts.name ?? "");
  const error = validate(opts, target);
  if (error) {
    console.error(`${error}\n\n${USAGE}`);
    process.exit(1);
  }
  const steps = plan({ ...opts, author: gitAuthor(), year: new Date().getFullYear() });
  if (opts.dryRun) {
    console.log(`would create ${target} (${opts.layout}):`);
    for (const s of steps) console.log(`  ${describeStep(s)}`);
    return;
  }
  const missing = missingTools(opts);
  if (missing.length) {
    console.error(`missing on PATH: ${missing.join(", ")}`);
    process.exit(1);
  }
  mkdirSync(target, { recursive: true });
  console.log(`creating ${target} (${opts.layout})`);
  const r = execute(steps, target, { log: (line) => console.log(`  ${line}`) });
  if (!r.ok) {
    console.error(`failed at: ${describeStep(r.step)}\n${r.error}\n\nThe partial project is left at ${target} to inspect.`);
    process.exit(1);
  }
  console.log(`done: ${target}`);
  console.log("next: make check, then make the first commit (signed)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2));
}
