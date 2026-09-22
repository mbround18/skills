#!/usr/bin/env node
// Symlinks this skill into ~/.claude/skills/<name> so it's available in
// every Claude Code session, not just this repo. Re-run after `git pull`
// only if the symlink was somehow replaced — normally a pull is enough,
// since the installed skill is a link back to this checkout.

import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Symlink `sourceDir` into `targetSkillsDir/<basename(sourceDir)>`, replacing whatever is there. */
export function installSkill(sourceDir, targetSkillsDir) {
  const target = join(targetSkillsDir, basename(sourceDir));

  mkdirSync(targetSkillsDir, { recursive: true });

  if (existsSync(target) || lstatSync(target, { throwIfNoEntry: false })) {
    rmSync(target, { recursive: true, force: true });
  }

  symlinkSync(sourceDir, target, "dir");
  return target;
}

export function main() {
  const targetSkillsDir = join(homedir(), ".claude", "skills");
  const target = installSkill(skillDir, targetSkillsDir);
  console.log(`linked ${skillDir} -> ${target}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
