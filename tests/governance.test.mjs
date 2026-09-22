// Repo-wide rules every skill under skills/ must satisfy. These exist so a
// new skill can't land half-finished: no SKILL.md without a README, no
// scripts without tests, no name that breaks the agentskills.io spec.
// See AGENTS.md for the checklist this enforces in prose.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { readScalarField, splitFrontmatter } from "./skill-frontmatter.mjs";

const repoRoot = join(fileURLToPath(import.meta.url), "..", "..");
const skillsDir = join(repoRoot, "skills");

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const skillNames = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

describe("repo scaffolding", () => {
  for (const file of ["README.md", "LICENSE", "AGENTS.md", "pnpm-workspace.yaml", "package.json"]) {
    it(`has a root ${file}`, () => {
      assert.ok(existsSync(join(repoRoot, file)), `missing ${file} at repo root`);
    });
  }

  it("finds at least one skill", () => {
    assert.ok(skillNames.length > 0, "skills/ has no skill directories");
  });
});

describe("every skill", () => {
  for (const name of skillNames) {
    const dir = join(skillsDir, name);

    describe(name, () => {
      it("has a SKILL.md with valid frontmatter", () => {
        const skillMdPath = join(dir, "SKILL.md");
        assert.ok(existsSync(skillMdPath), `${name}/SKILL.md is missing`);

        const { frontmatter } = splitFrontmatter(readFileSync(skillMdPath, "utf8"));
        assert.ok(frontmatter, `${name}/SKILL.md has no --- frontmatter block`);

        const fmName = readScalarField(frontmatter, "name");
        assert.equal(fmName, name, `SKILL.md name "${fmName}" must match directory name "${name}"`);
        assert.ok(NAME_RE.test(fmName), `SKILL.md name "${fmName}" must be lowercase, digits, single hyphens`);
        assert.ok(fmName.length <= 64, "SKILL.md name must be at most 64 characters");

        const description = readScalarField(frontmatter, "description");
        assert.ok(description && description.length > 0, "SKILL.md description must be non-empty");
        assert.ok(description.length <= 1024, "SKILL.md description must be at most 1024 characters");
      });

      it("has a consumer-facing README.md", () => {
        const readmePath = join(dir, "README.md");
        assert.ok(existsSync(readmePath), `${name}/README.md is missing`);

        const readme = readFileSync(readmePath, "utf8");
        assert.ok(/^#\s+\S/m.test(readme), `${name}/README.md needs a top-level heading`);
        assert.ok(readme.length >= 200, `${name}/README.md looks like a stub (under 200 characters)`);
      });

      it("has a package.json with a test script", () => {
        const pkgPath = join(dir, "package.json");
        assert.ok(existsSync(pkgPath), `${name}/package.json is missing`);

        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        assert.ok(pkg.name, `${name}/package.json needs a "name"`);
        assert.ok(pkg.scripts && pkg.scripts.test, `${name}/package.json needs a "scripts.test"`);
      });

      it("has its own tests", () => {
        const testsDir = join(dir, "tests");
        assert.ok(existsSync(testsDir) && statSync(testsDir).isDirectory(), `${name}/tests/ is missing`);

        const testFiles = readdirSync(testsDir).filter((f) => f.endsWith(".test.mjs"));
        assert.ok(testFiles.length > 0, `${name}/tests/ has no *.test.mjs files`);
      });
    });
  }
});
