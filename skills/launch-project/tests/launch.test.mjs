import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  findCaseInsensitive,
  parseArgs,
  pickTerminal,
  resolveProject,
  shQuote,
  which,
} from "../scripts/launch.mjs";

describe("shQuote", () => {
  it("wraps a plain string in single quotes", () => {
    assert.equal(shQuote("/home/user/project"), "'/home/user/project'");
  });

  it("escapes embedded single quotes", () => {
    assert.equal(shQuote("it's"), "'it'\\''s'");
  });
});

describe("which", () => {
  it("finds a binary that is on PATH", () => {
    assert.equal(which("sh"), true);
  });

  it("returns false for a binary that does not exist", () => {
    assert.equal(which("definitely-not-a-real-binary-xyz"), false);
  });
});

describe("parseArgs", () => {
  it("takes the first argument as the project", () => {
    assert.deepEqual(parseArgs(["my-project"]), {
      projectArg: "my-project",
      opts: { sessionName: undefined },
    });
  });

  it("reads --session-name", () => {
    assert.deepEqual(parseArgs(["my-project", "--session-name", "custom"]), {
      projectArg: "my-project",
      opts: { sessionName: "custom" },
    });
  });
});

describe("pickTerminal", () => {
  it("picks the first terminal on PATH from a candidate list", () => {
    const terminals = [
      { bin: "definitely-not-a-real-binary-xyz", needsWrapper: false, args: () => [] },
      { bin: "sh", needsWrapper: false, args: () => [] },
    ];
    assert.equal(pickTerminal(terminals).bin, "sh");
  });

  it("throws when nothing on the list is available", () => {
    const terminals = [
      { bin: "definitely-not-a-real-binary-xyz", needsWrapper: false, args: () => [] },
    ];
    assert.throws(() => pickTerminal(terminals), /no supported terminal/);
  });
});

describe("findCaseInsensitive and resolveProject", () => {
  let root;

  before(() => {
    // root/
    //   Group/
    //     ThunderForgeVTT/
    //   flat-project/
    root = mkdtempSync(join(tmpdir(), "launch-project-test-"));
    mkdirSync(join(root, "Group", "ThunderForgeVTT"), { recursive: true });
    mkdirSync(join(root, "flat-project"), { recursive: true });
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("matches an exact-case directory at depth 1", () => {
    assert.equal(findCaseInsensitive(root, "flat-project", 2), join(root, "flat-project"));
  });

  it("matches a mis-cased name nested one level deep", () => {
    assert.equal(
      findCaseInsensitive(root, "thunderforgevtt", 2),
      join(root, "Group", "ThunderForgeVTT"),
    );
  });

  it("does not descend past the given depth", () => {
    assert.equal(findCaseInsensitive(root, "thunderforgevtt", 1), undefined);
  });

  it("returns undefined for a name that does not exist anywhere", () => {
    assert.equal(findCaseInsensitive(root, "nope", 2), undefined);
  });

  it("resolveProject finds a project via case-insensitive nested search", () => {
    assert.equal(resolveProject("ThunderForgeVtt", [root]), join(root, "Group", "ThunderForgeVTT"));
  });

  it("resolveProject prefers a direct, exact-case match", () => {
    assert.equal(resolveProject("flat-project", [root]), join(root, "flat-project"));
  });

  it("resolveProject throws with the searched roots when nothing matches", () => {
    assert.throws(() => resolveProject("does-not-exist", [root]), /could not find project/);
  });
});
