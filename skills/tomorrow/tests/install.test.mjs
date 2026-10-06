import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { installSkill } from "../scripts/install.mjs";

describe("installSkill", () => {
  let work, sourceDir, targetSkillsDir;

  before(() => {
    work = mkdtempSync(join(tmpdir(), "tomorrow-install-"));
    sourceDir = join(work, "tomorrow");
    targetSkillsDir = join(work, "claude-skills");
    mkdirSync(sourceDir, { recursive: true });
  });

  after(() => rmSync(work, { recursive: true, force: true }));

  it("symlinks the skill into the skills directory", () => {
    const target = installSkill(sourceDir, targetSkillsDir);
    assert.equal(target, join(targetSkillsDir, "tomorrow"));
    assert.ok(lstatSync(target).isSymbolicLink());
    assert.equal(readlinkSync(target), sourceDir);
  });

  it("replaces an existing link rather than failing", () => {
    const target = installSkill(sourceDir, targetSkillsDir);
    assert.equal(readlinkSync(target), sourceDir);
  });
});
