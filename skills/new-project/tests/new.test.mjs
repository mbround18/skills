import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { DISCORD } from "../scripts/files.mjs";
import { LAYOUTS, applyJson, checkName, describeStep, execute, parseArgs, plan, validate } from "../scripts/new.mjs";

const base = { name: "demo", license: "bsd-3-clause", author: "Ada", year: 2026 };
const stepsFor = (layout, extra = {}) => plan({ ...base, layout, ...extra });
const written = (steps, path) => steps.find((s) => s.write === path)?.content;
const runs = (steps) => steps.filter((s) => s.run).map((s) => s.run.join(" "));

describe("checkName", () => {
  it("accepts names cargo and pnpm both take", () => {
    assert.equal(checkName("bopo-2"), undefined);
  });
  it("rejects the rest", () => {
    for (const n of ["", "Demo", "2demo", "a--b", "a_b", "-a", "a-"]) assert.ok(checkName(n), n);
  });
});

describe("plan", () => {
  it("lets cargo generate the crates, after the workspace folders exist", () => {
    const s = stepsFor("rust");
    const i = (pred) => s.findIndex(pred);
    assert.ok(i((x) => x.mkdir === "crates") < i((x) => x.run?.[1] === "new"));
    assert.ok(i((x) => x.write === "Cargo.toml") < i((x) => x.run?.[1] === "new"));
    assert.deepEqual(runs(s), [
      "git init -q -b main",
      "cargo new --quiet --vcs none --lib crates/demo-core",
      "cargo new --quiet --vcs none apps/demo",
    ]);
    assert.doesNotMatch(written(s, "Cargo.toml"), /exclude/);
    assert.equal(written(s, "apps/demo/src/main.rs"), undefined, "plain rust keeps cargo's main.rs");
    assert.equal(written(s, "pnpm-workspace.yaml"), undefined);
  });

  it("rust-react adds the Axum server and the Vite app from create-vite", () => {
    const s = stepsFor("rust-react");
    const r = runs(s);
    for (const cmd of [
      "cargo add --quiet -p demo axum",
      "cargo add --quiet -p demo tokio -F full",
      "cargo add --quiet -p demo tower-http -F fs",
      "cargo add --quiet -p demo clap -F derive,env",
      "pnpm create vite@latest apps/web --template react-ts --no-interactive --no-immediate",
      "pnpm --filter web add @demo/core --workspace",
    ]) {
      assert.ok(r.includes(cmd), cmd);
    }
    const main = written(s, "apps/demo/src/main.rs");
    assert.match(main, /env = "STATIC_DIR"/);
    assert.match(main, /ServeDir/);
    assert.doesNotMatch(main, /rust.embed|include_(str|bytes)/, "assets are served from disk, not embedded");
    assert.match(written(s, "pnpm-workspace.yaml"), /"apps\/\*"[\s\S]*"packages\/\*"/);
    assert.match(written(s, "Cargo.toml"), /exclude = \["apps\/web"\]/, "the Vite app isn't a crate");
  });

  it("web needs no cargo", () => {
    assert.ok(!runs(stepsFor("web")).some((c) => c.startsWith("cargo")));
    assert.equal(written(stepsFor("web"), "Cargo.toml"), undefined);
  });

  it("writes a Makefile whose build runs gc, and gc never fails", () => {
    const mk = written(stepsFor("rust-react"), "Makefile");
    assert.match(mk, /^build: gc$/m);
    assert.match(mk, /cargo sweep --time \$\(GC_DAYS\) \|\| true/);
    assert.match(mk, /cargo install cargo-sweep --locked/);
    assert.match(mk, /docker builder prune -f --max-used-space \$\(GC_DOCKER_KEEP\)/);
    assert.doesNotMatch(mk, /--keep-storage/);
    assert.doesNotMatch(written(stepsFor("rust", { docker: false }), "Makefile"), /docker/);
    assert.match(written(stepsFor("rust-react"), "Makefile"), /^\tcargo build --workspace$/m);
  });

  it("builds Docker images in stages with cargo-chef, assets beside the binary", () => {
    const df = written(stepsFor("rust-react"), "Dockerfile");
    for (const stage of ["AS chef", "AS planner", "AS builder", "AS web"]) assert.ok(df.includes(stage), stage);
    assert.match(df, /cargo chef cook --release/);
    assert.match(df, /COPY --from=web \/app\/apps\/web\/dist \/srv\/www/);
    assert.match(df, /ENV STATIC_DIR=\/srv\/www/);
    assert.match(df, /USER app/);
  });

  it("serves the web-only build with nginx, deep links included", () => {
    const df = written(stepsFor("web"), "Dockerfile");
    assert.doesNotMatch(df, /cargo/);
    assert.match(df, /try_files \$uri \$uri\/ \/index\.html/);
  });

  it("compose never hard-codes a restart policy", () => {
    for (const layout of Object.keys(LAYOUTS)) {
      const c = written(stepsFor(layout), "compose.yaml");
      assert.match(c, /restart: \$\{RESTART_POLICY:-no\}/);
      assert.doesNotMatch(c, /restart: (always|unless-stopped|on-failure)/);
    }
  });

  it("rust-react shares a GraphQL contract crate between server and frontend", () => {
    const s = stepsFor("rust-react");
    const r = runs(s);
    for (const cmd of [
      "cargo new --quiet --vcs none --lib crates/demo-contract",
      "cargo add --quiet -p demo-contract async-graphql --no-default-features",
      "cargo add --quiet -p demo async-graphql-axum",
      "cargo add --quiet -p demo --path crates/demo-contract",
      "pnpm --filter web add graphql",
    ]) {
      assert.ok(r.includes(cmd), cmd);
    }
    // The schema is exported before the frontend is built from it.
    const exportAt = s.findIndex((x) => x.env?.UPDATE_SCHEMA);
    assert.ok(exportAt > 0 && exportAt < s.findIndex((x) => x.write === "apps/web/codegen.ts"));
    const lib = written(s, "crates/demo-contract/src/lib.rs");
    assert.match(lib, /pub fn schema\(\) -> AppSchema/);
    assert.match(lib, /UPDATE_SCHEMA/, "the test re-exports schema.graphql on request");
    assert.match(lib, /run `make schema`/, "and otherwise fails when it's stale");
    assert.match(written(s, "apps/demo/src/main.rs"), /route_service\("\/graphql", GraphQL::new\(demo_contract::schema\(\)\)\)/);
    assert.match(written(s, "apps/web/codegen.ts"), /schema: "\.\.\/\.\.\/crates\/demo-contract\/schema\.graphql"/);
    assert.match(written(s, "apps/web/src/api.ts"), /query Health/);
    const scripts = s.find((x) => x.json === "apps/web/package.json").merge.scripts;
    assert.match(scripts.build, /^graphql-codegen && /, "types are generated before tsc sees them");
    const mk = written(s, "Makefile");
    assert.match(mk, /^schema:\n\tUPDATE_SCHEMA=1 cargo test -q -p demo-contract\n\tpnpm --filter web codegen$/m);
    assert.match(mk, /cargo check -p demo-contract --target wasm32-unknown-unknown/);
    assert.match(written(s, ".gitignore"), /^apps\/web\/src\/gql\/$/m);
    assert.match(written(s, "CONTRIBUTING.md"), /## GraphQL[\s\S]*make schema/);
  });

  it("--no-graphql, rust and web leave the contract out", () => {
    for (const s of [stepsFor("rust-react", { graphql: false }), stepsFor("rust"), stepsFor("web")]) {
      assert.equal(written(s, "crates/demo-contract/src/lib.rs"), undefined);
      assert.doesNotMatch(written(s, "Makefile"), /schema|wasm32/);
      assert.ok(!runs(s).some((c) => c.includes("graphql")));
    }
    assert.doesNotMatch(written(stepsFor("rust-react", { graphql: false }), "apps/demo/src/main.rs"), /graphql/i);
  });

  it("--no-docker leaves Docker out", () => {
    const s = stepsFor("rust-react", { docker: false });
    for (const f of ["Dockerfile", ".dockerignore", "compose.yaml"]) assert.equal(written(s, f), undefined, f);
  });

  it("licenses and documents the project", () => {
    const s = stepsFor("rust-react");
    assert.match(written(s, "LICENSE"), /^BSD 3-Clause License\n\nCopyright \(c\) 2026, Ada/);
    assert.match(written(stepsFor("rust", { license: "mit" }), "LICENSE"), /^MIT License\n\nCopyright \(c\) 2026 Ada/);
    assert.match(written(stepsFor("rust", { license: "apache-2.0" }), "LICENSE"), /Apache License\s+Version 2\.0/);
    assert.ok(written(s, "README.md").includes(DISCORD));
    assert.match(written(s, "CONTRIBUTING.md"), /apps\/demo/);
    assert.ok(written(s, "docs/guides/README.md"));
    assert.match(written(s, ".gitignore"), /^target\/$[\s\S]*^node_modules\/$[\s\S]*^\.env$/m);
  });

  it("describes each step on one line", () => {
    assert.equal(describeStep({ run: ["pnpm", "init"], cwd: "packages/core" }), "run    pnpm init  (in packages/core)");
    assert.equal(describeStep({ write: "LICENSE" }), "write  LICENSE");
  });
});

describe("applyJson and args", () => {
  it("replaces set keys and drops the rest", () => {
    assert.deepEqual(applyJson({ a: 1, b: 2, scripts: { test: "x" } }, { set: { scripts: {} }, drop: ["b"] }), { a: 1, scripts: {} });
    assert.deepEqual(applyJson({ scripts: { dev: "vite", lint: "oxlint" } }, { merge: { scripts: { dev: "x && vite" } } }), {
      scripts: { dev: "x && vite", lint: "oxlint" },
    });
  });
  it("parses the flags", () => {
    assert.equal(parseArgs(["--no-graphql"]).graphql, false);
    assert.deepEqual(parseArgs(["demo", "--layout", "web", "--no-docker", "--dry-run"]), {
      license: "bsd-3-clause",
      docker: false,
      name: "demo",
      layout: "web",
      dryRun: true,
    });
  });
});

describe("validate", () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "np-val-"));
    mkdirSync(join(dir, "taken"));
    writeFileSync(join(dir, "taken", "x"), "");
    mkdirSync(join(dir, "empty"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));
  const v = (o, t) => validate({ license: "bsd-3-clause", ...o }, join(dir, t));
  it("refuses a folder that has something in it", () => {
    assert.match(v({ name: "taken", layout: "rust" }, "taken"), /isn't empty/);
    assert.equal(v({ name: "empty", layout: "rust" }, "empty"), undefined);
  });
  it("wants a layout and a known licence", () => {
    assert.match(v({ name: "a" }, "a"), /pick a layout/);
    assert.match(v({ name: "a", layout: "rust", license: "gpl" }, "a"), /unknown licence/);
  });
});

describe("execute, with fake generators", () => {
  let root, bin, log, env;
  before(() => {
    root = mkdtempSync(join(tmpdir(), "np-exec-"));
    bin = join(root, "bin");
    log = join(root, "calls.log");
    mkdirSync(bin);
    // Stand-ins that record their arguments and leave behind what the real tool would.
    const fake = {
      cargo: `case "$1" in new) d="$(eval echo \\$$#)"; mkdir -p "$d/src"; echo '[package]' > "$d/Cargo.toml"; echo 'fn main() {}' > "$d/src/main.rs";; add) if [ -n "$FAIL_ADD" ]; then echo "boom: no network" >&2; exit 101; fi;; test) echo "UPDATE_SCHEMA=$UPDATE_SCHEMA" >> "${log}";; esac`,
      pnpm: `case "$1" in init) echo '{"name":"x","main":"index.js","keywords":[],"author":"","scripts":{"test":"exit 1"}}' > package.json;; create) mkdir -p "$3"; echo '{"name":"web"}' > "$3/package.json";; esac`,
    };
    for (const [name, body] of Object.entries(fake)) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    }
    env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it("runs every step and leaves our files beside the tools' output", () => {
    const target = join(root, "demo");
    mkdirSync(target);
    const lines = [];
    const r = execute(stepsFor("rust-react"), target, { env, log: (l) => lines.push(l) });
    assert.equal(r.ok, true, r.error);
    for (const f of ["Cargo.toml", "apps/demo/src/main.rs", "crates/demo-core/Cargo.toml", "apps/web/package.json", "Makefile", "Dockerfile", "LICENSE", ".git"]) {
      assert.ok(existsSync(join(target, f)), f);
    }
    assert.match(readFileSync(join(target, "apps/demo/src/main.rs"), "utf8"), /STATIC_DIR/, "our main.rs replaces cargo's");
    const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8"));
    assert.equal(pkg.name, "demo");
    assert.equal(pkg.private, true);
    assert.equal(pkg.license, "BSD-3-Clause");
    assert.equal(pkg.main, undefined);
    assert.equal(pkg.scripts.build, "pnpm -r build");
    const core = JSON.parse(readFileSync(join(target, "packages/core/package.json"), "utf8"));
    assert.equal(core.name, "@demo/core");
    assert.deepEqual(core.scripts, {});
    assert.equal(lines.length, stepsFor("rust-react").length);
    assert.match(readFileSync(log, "utf8"), /^pnpm init$/m);
    assert.match(readFileSync(log, "utf8"), /^UPDATE_SCHEMA=1$/m, "a step's env reaches the tool");
    const web = JSON.parse(readFileSync(join(target, "apps/web/package.json"), "utf8"));
    assert.equal(web.name, "web", "create-vite's fields survive");
    assert.equal(web.scripts.codegen, "graphql-codegen");
  });

  it("stops at the first failing tool and says which", () => {
    const target = join(root, "broken");
    mkdirSync(target);
    const r = execute(stepsFor("rust-react"), target, { env: { ...env, FAIL_ADD: "1" } });
    assert.equal(r.ok, false);
    assert.deepEqual(r.step.run.slice(0, 2), ["cargo", "add"]);
    assert.match(r.error, /boom: no network/);
    assert.equal(existsSync(join(target, "Makefile")), false, "later steps didn't run");
  });
});

describe("CLI", () => {
  const script = fileURLToPath(new URL("../scripts/new.mjs", import.meta.url));
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "np-cli-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));
  it("--dry-run lists the steps and writes nothing", () => {
    const r = spawnSync("node", [script, "demo", "--layout", "rust", "--dir", dir, "--dry-run"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /would create .*demo \(rust\)/);
    assert.match(r.stdout, /run {4}cargo new --quiet --vcs none apps\/demo/);
    assert.equal(existsSync(join(dir, "demo")), false);
  });
  it("explains a bad call", () => {
    const r = spawnSync("node", [script, "Demo", "--layout", "rust", "--dir", dir], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /isn't a valid name[\s\S]*usage:/);
  });
});
