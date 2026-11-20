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

function scriptFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? scriptFiles(join(dir, e.name)) : e.name.endsWith(".mjs") ? [join(dir, e.name)] : [],
  );
}

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

describe("install", () => {
  it("has one root installer and the remote one-liner script", () => {
    for (const f of ["scripts/install.mjs", "install.sh"]) assert.ok(existsSync(join(repoRoot, f)), `missing ${f}`);
  });

  it("no skill ships its own installer — scripts/install.mjs at the root installs them all", () => {
    const own = skillNames.filter((n) => existsSync(join(skillsDir, n, "scripts", "install.mjs")));
    assert.deepEqual(own, [], `delete skills/<name>/scripts/install.mjs from: ${own.join(", ")}`);
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

      it("guards CLI entrypoints so they also run through the installed symlink", () => {
        for (const file of scriptFiles(join(dir, "scripts"))) {
          const src = readFileSync(file, "utf8");
          const rel = file.slice(skillsDir.length + 1);
          assert.ok(
            !src.includes("`file://${process.argv[1]}`"),
            `${rel}: compares import.meta.url with the unresolved argv[1], so main() never runs through a symlink — use pathToFileURL(realpathSync(process.argv[1])).href`,
          );
          if (/import\.meta\.url ===/.test(src)) {
            assert.match(src, /realpathSync\(process\.argv\[1\]\)/, `${rel}: CLI guard must compare against realpathSync(process.argv[1])`);
          }
        }
      });

      it("says what its SKILL.md script paths are relative to", () => {
        const skillMd = readFileSync(join(dir, "SKILL.md"), "utf8");
        if (!/node scripts\//.test(skillMd)) return;
        assert.match(skillMd, /relative to this skill's directory/i, `${name}/SKILL.md runs node scripts/... but never says paths are relative to this skill's directory`);
      });
    });
  }
});
