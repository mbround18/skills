import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { availableSkills, installSkill, parseArgs, repoRoot } from "../scripts/install.mjs";

const tmp = mkdtempSync(join(tmpdir(), "skills-install-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const cli = join(repoRoot, "scripts", "install.mjs");
let n = 0;
const fresh = () => join(tmp, `target-${++n}`);
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, CLAUDE_SKILLS_DIR: join(tmp, "unused") } });

describe("root installer", () => {
  it("lists every skill directory that has a SKILL.md", () => {
    const skills = availableSkills();
    for (const s of ["launch-project", "pdf-parse", "pwa", "tomorrow"]) assert.ok(skills.includes(s), s);
    assert.deepEqual(run("--list").stdout.trim().split("\n"), skills);
  });

  it("symlinks a skill into the target, and re-running is a no-op", () => {
    const target = fresh();
    const r = installSkill("pwa", { target });
    assert.ok(r.changed);
    assert.ok(lstatSync(join(target, "pwa")).isSymbolicLink());
    assert.equal(readlinkSync(join(target, "pwa")), join(repoRoot, "skills", "pwa"));
    assert.equal(installSkill("pwa", { target }).changed, false);
  });

  it("replaces a stale symlink but refuses to delete a real directory", () => {
    const target = fresh();
    mkdirSync(target, { recursive: true });
    symlinkSync(tmp, join(target, "pwa"), "dir");
    assert.ok(installSkill("pwa", { target }).changed);
    mkdirSync(join(target, "tomorrow"));
    writeFileSync(join(target, "tomorrow", "mine.txt"), "keep me");
    assert.throws(() => installSkill("tomorrow", { target }), /not a symlink/);
    assert.ok(existsSync(join(target, "tomorrow", "mine.txt")));
  });

  it("CLI installs several skills, or all, into --target", () => {
    const a = fresh();
    const out = execFileSync(process.execPath, [cli, "pwa", "pdf-parse", "--target", a], { encoding: "utf8" });
    assert.match(out, /linked .*pwa/);
    assert.ok(existsSync(join(a, "pdf-parse", "SKILL.md")));
    const b = fresh();
    execFileSync(process.execPath, [cli, "--all", "--target", b]);
    for (const s of availableSkills()) assert.ok(existsSync(join(b, s, "SKILL.md")), s);
  });

  it("CLI rejects an unknown name before installing anything", () => {
    const target = fresh();
    const r = run("pwa", "nope", "--target", target);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown skill nope/);
    assert.ok(!existsSync(join(target, "pwa")));
  });

  it("CLI with no skills prints usage and the available skills", () => {
    const r = run();
    assert.equal(r.status, 2);
    assert.match(r.stderr, /usage/);
    assert.match(r.stderr, /pwa/);
    assert.throws(() => parseArgs(["--bogus"]), /unknown option/);
  });

  it("install.sh is valid bash", () => {
    assert.equal(spawnSync("bash", ["-n", join(repoRoot, "install.sh")]).status, 0);
  });
});
