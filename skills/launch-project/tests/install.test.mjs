import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { installSkill } from "../scripts/install.mjs";

describe("installSkill", () => {
  let work, sourceDir, targetSkillsDir;

  before(() => {
    work = mkdtempSync(join(tmpdir(), "install-test-"));
    sourceDir = join(work, "launch-project");
    targetSkillsDir = join(work, "claude-skills");
    mkdirSync(sourceDir, { recursive: true });
  });

  after(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it("creates the target skills directory and symlinks the skill into it", () => {
    const target = installSkill(sourceDir, targetSkillsDir);
    assert.equal(target, join(targetSkillsDir, "launch-project"));
    assert.ok(lstatSync(target).isSymbolicLink());
    assert.equal(readlinkSync(target), sourceDir);
    assert.ok(existsSync(target));
  });

  it("replaces an existing link on re-install instead of erroring", () => {
    const otherSource = join(work, "other-source");
    mkdirSync(otherSource, { recursive: true });

    installSkill(otherSource, targetSkillsDir);
    const target = installSkill(sourceDir, targetSkillsDir);

    assert.equal(readlinkSync(target), sourceDir);
  });
});
