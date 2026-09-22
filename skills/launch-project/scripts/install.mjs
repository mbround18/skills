#!/usr/bin/env node
// Symlinks this skill into ~/.claude/skills/<name> so it's available in
// every Claude Code session, not just this repo. Re-run after `git pull`
// only if the symlink was somehow replaced — normally a pull is enough,
// since the installed skill is a link back to this checkout.

import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillName = skillDir.split("/").pop();
const targetDir = join(homedir(), ".claude", "skills");
const target = join(targetDir, skillName);

mkdirSync(targetDir, { recursive: true });

if (existsSync(target) || lstatSync(target, { throwIfNoEntry: false })) {
  rmSync(target, { recursive: true, force: true });
}

symlinkSync(skillDir, target, "dir");
console.log(`linked ${skillDir} -> ${target}`);
