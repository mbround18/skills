#!/usr/bin/env node
// Install skills from this checkout by symlinking them into
// ~/.claude/skills (or --target / $CLAUDE_SKILLS_DIR). The installed skill
// is a link back here, so `git pull` updates it.
//
//   node scripts/install.mjs <skill> [more ...]
//   node scripts/install.mjs --all
//   node scripts/install.mjs --list
//
// Remote, without cloning by hand (install.sh clones, then runs this):
//   curl -fsSL https://raw.githubusercontent.com/mbround18/skills/main/install.sh | bash -s -- <skill> [...]

import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Skill directory names under <root>/skills (those with a SKILL.md), sorted. */
export function availableSkills(root = repoRoot) {
  const dir = join(root, "skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

/**
 * Symlink <root>/skills/<name> into <target>/<name>. Replaces an existing
 * symlink; refuses to delete a real file or directory someone put there.
 */
export function installSkill(name, { root = repoRoot, target } = {}) {
  const source = join(root, "skills", name);
  if (!existsSync(join(source, "SKILL.md"))) throw new Error(`unknown skill "${name}" (available: ${availableSkills(root).join(", ") || "none"})`);
  const dest = join(target, name);
  mkdirSync(target, { recursive: true });
  const st = lstatSync(dest, { throwIfNoEntry: false });
  if (st && !st.isSymbolicLink()) throw new Error(`${dest} exists and is not a symlink; move it aside and re-run`);
  if (st) {
    if (readlinkSync(dest) === source) return { name, dest, source, changed: false };
    rmSync(dest);
  }
  symlinkSync(source, dest, "dir");
  return { name, dest, source, changed: true };
}

export function defaultTarget(env = process.env) {
  return env.CLAUDE_SKILLS_DIR || join(homedir(), ".claude", "skills");
}

export function parseArgs(argv) {
  const a = { names: [], all: false, list: false, target: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--all") a.all = true;
    else if (v === "--list") a.list = true;
    else if (v === "--target") a.target = argv[++i];
    else if (v === "-h" || v === "--help") a.help = true;
    else if (v.startsWith("-")) throw new Error(`unknown option ${v}`);
    else a.names.push(v);
  }
  return a;
}

const USAGE = "usage: install.mjs <skill> [more ...] | --all | --list   [--target dir]";

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const skills = availableSkills();
  if (opts.list) {
    console.log(skills.join("\n"));
    return;
  }
  if (opts.help || (!opts.all && !opts.names.length)) {
    console.error(`${USAGE}\navailable: ${skills.join(", ")}`);
    process.exitCode = opts.help ? 0 : 2;
    return;
  }
  const target = resolve(opts.target ?? defaultTarget());
  const names = opts.all ? skills : [...new Set(opts.names)];
  // Validate everything before touching the target, so a typo installs nothing.
  const unknown = names.filter((n) => !skills.includes(n));
  if (unknown.length) throw new Error(`unknown skill${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")} (available: ${skills.join(", ")})`);
  for (const n of names) {
    const r = installSkill(n, { target });
    console.log(`${r.changed ? "linked" : "already linked"} ${r.dest} -> ${r.source}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    main();
  } catch (err) {
    console.error(`install: ${err.message}`);
    process.exitCode = 1;
  }
}
