import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import {
  brightText,
  claudeCommand,
  closeReport,
  gitState,
  parseClaudeArgv,
  parseScreen,
  sessionBaseName,
  uniqueName,
  isTrusted,
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

  it("reads --prompt-file", () => {
    assert.deepEqual(parseArgs(["p", "--prompt-file", "/tmp/brief.md", "--session-name", "s"]), {
      projectArg: "p",
      opts: { sessionName: "s", promptFile: "/tmp/brief.md" },
    });
  });
});

describe("claudeCommand", () => {
  it("is plain Remote Control without a brief", () => {
    assert.deepEqual(claudeCommand(), ["claude", "--remote-control"]);
    assert.deepEqual(claudeCommand({ prompt: "  \n" }), ["claude", "--remote-control"]);
  });

  it("passes the brief as the first prompt, after the session name", () => {
    assert.deepEqual(claudeCommand({ sessionName: "x", prompt: "do it" }), ["claude", "--remote-control=x", "do it"]);
  });

  it("survives the shell wrapper intact: quotes, newlines, $ and backticks", () => {
    const prompt = "it's a `brief`\nwith $HOME and \"quotes\"";
    const line = claudeCommand({ prompt }).map(shQuote).join(" ");
    const out = spawnSync("bash", ["-c", `printf '%s\\0' ${line}`], { encoding: "utf8" }).stdout;
    assert.deepEqual(out.split("\0").slice(0, -1), ["claude", "--remote-control", prompt]);
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

describe("run as a script", () => {
  it("runs when invoked through a symlink, as an installed skill is", () => {
    const dir = mkdtempSync(join(tmpdir(), "launch-link-"));
    try {
      const link = join(dir, "launch.mjs");
      symlinkSync(fileURLToPath(new URL("../scripts/launch.mjs", import.meta.url)), link);
      // No project argument: prints usage and exits 1 without opening anything.
      const run = spawnSync("node", [link], { encoding: "utf8" });
      assert.match(run.stderr, /usage: launch\.mjs/);
      assert.equal(run.status, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("isTrusted", () => {
  const config = { projects: { "/home/u/dev": { hasTrustDialogAccepted: true }, "/home/u/other": { hasTrustDialogAccepted: false } } };
  it("trusts a folder accepted itself, not one under an accepted parent", () => {
    assert.equal(isTrusted("/home/u/dev", config), true);
    assert.equal(isTrusted("/home/u/dev/app", config), false);
  });
  it("doesn't trust a folder that was never accepted", () => {
    assert.equal(isTrusted("/home/u/other", config), false);
    assert.equal(isTrusted("/srv/x", config), false);
    assert.equal(isTrusted("/srv/x", null), false);
  });
});

describe("session names", () => {
  it("uses the given name, else the folder's, made safe for tmux", () => {
    assert.equal(sessionBaseName("valheim-pr1596", "/x"), "valheim-pr1596");
    assert.equal(sessionBaseName(undefined, "/home/u/valheim.boop.ninja"), "valheim-boop-ninja");
    assert.equal(sessionBaseName("a:b c", "/x"), "a-b-c");
  });
  it("adds a number when the name is taken", () => {
    assert.equal(uniqueName("web", []), "web");
    assert.equal(uniqueName("web", ["web", "web-2"]), "web-3");
  });
});

describe("parseScreen", () => {
  const rule = "─".repeat(40);
  it("reads typed text in the input box, not its dim placeholder", () => {
    assert.equal(parseScreen(`${rule}\n❯ hardcode it too\n${rule}`).unsent, "hardcode it too");
    const dimPlaceholder = `${rule}\n\x1b[38;5;246m❯ \x1b[2m\x1b[39mPress up to edit queued messages\x1b[0m\n${rule}`;
    assert.equal(parseScreen(dimPlaceholder).unsent, "");
    assert.equal(parseScreen(`${rule}\n❯ \n${rule}`).unsent, "");
  });
  it("sees the trust prompt, and doesn't mistake its choices for input", () => {
    const trust = `${rule}\n Accessing workspace:\n ❯ No, exit\n   Yes, I trust this folder\n Enter to confirm · Esc to cancel`;
    assert.deepEqual(parseScreen(trust), { trustPrompt: true, unsent: "", url: undefined });
  });
  it("finds the Remote Control link", () => {
    const s = "/remote-control is active · Continue here, on your phone, or at https://claude.ai/code/session_01AbC";
    assert.equal(parseScreen(s).url, "https://claude.ai/code/session_01AbC");
  });
  it("brightText drops dim runs and escape codes", () => {
    assert.equal(brightText("a\x1b[2mdim\x1b[22mb\x1b[1;31mc"), "abc");
  });
});

describe("parseClaudeArgv", () => {
  it("matches claude --remote-control and reads its name", () => {
    assert.deepEqual(parseClaudeArgv(["claude", "--remote-control=x", "brief"]), { name: "x" });
    assert.deepEqual(parseClaudeArgv(["/usr/bin/claude", "--remote-control"]), { name: undefined });
  });
  it("ignores other processes, including shells that mention it", () => {
    assert.equal(parseClaudeArgv(["claude"]), null);
    assert.equal(parseClaudeArgv(["bash", "-c", "claude --remote-control=x"]), null);
  });
});

describe("closeReport", () => {
  it("blocks on unsent input and unfinished git work, reports containers", () => {
    const r = closeReport({ unsent: "hi", git: { dirty: 2, unpushed: 1 }, containers: ["web-1"] });
    assert.deepEqual(r.blockers, ['unsent input: "hi"', "2 uncommitted changes", "1 commit not on any remote"]);
    assert.deepEqual(r.leftovers, ["containers still running (not removed): web-1"]);
  });
  it("has nothing to say about a clean session", () => {
    assert.deepEqual(closeReport({ unsent: "", git: null, containers: [] }), { blockers: [], leftovers: [] });
  });
});

describe("gitState", () => {
  it("counts uncommitted changes, and is null outside a repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "launch-git-"));
    try {
      assert.equal(gitState(dir), null);
      spawnSync("git", ["init", "-q", dir]);
      writeFileSync(join(dir, "f"), "x");
      assert.deepEqual(gitState(dir), { dirty: 1, unpushed: null, hasRemote: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("launch, list and close through tmux", { skip: !which("tmux") && "tmux not installed" }, () => {
  const socket = `launch-project-test-${process.pid}`;
  const script = fileURLToPath(new URL("../scripts/launch.mjs", import.meta.url));
  let home, bin, project, env;
  before(() => {
    home = mkdtempSync(join(tmpdir(), "launch-tmux-"));
    bin = join(home, "bin");
    project = join(home, "proj");
    mkdirSync(bin);
    mkdirSync(project);
    // A stand-in claude: shows a Remote Control link and an input box, then idles.
    writeFileSync(
      join(bin, "claude"),
      `#!/bin/sh\nprintf '%s\\n' '/remote-control is active · or at https://claude.ai/code/session_01Fake' '────────────────' "❯ $UNSENT" '────────────────'\nexec sleep 60\n`,
    );
    chmodSync(join(bin, "claude"), 0o755);
    env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, LAUNCH_PROJECT_TMUX_SOCKET: socket, DISPLAY: "", WAYLAND_DISPLAY: "", HOME: home };
  });
  after(() => {
    spawnSync("tmux", ["-L", socket, "kill-server"]);
    rmSync(home, { recursive: true, force: true });
  });
  const run = (...args) => spawnSync("node", [script, ...args], { encoding: "utf8", env });

  it("launches into a named tmux session and prints its link", () => {
    const out = run(project, "--session-name", "demo");
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /launched demo · .*proj · claude --remote-control=demo · no window/);
    assert.match(out.stdout, /url: https:\/\/claude\.ai\/code\/session_01Fake/);
  });

  it("lists it, with the saved link", () => {
    assert.match(run("list").stdout, /demo · .*proj · .*running · https:\/\/claude\.ai\/code\/session_01Fake/);
  });

  it("gives a taken name a number", () => {
    assert.match(run(project, "--session-name", "demo").stdout, /launched demo-2 /);
  });

  it("refuses to close over unsent input unless forced", () => {
    env.UNSENT = "half a thought";
    assert.equal(spawnSync("tmux", ["-L", socket, "set-environment", "-g", "UNSENT", "half a thought"]).status, 0);
    assert.match(run(project, "--session-name", "typed").stdout, /launched typed /);
    const refused = run("close", "typed");
    assert.equal(refused.status, 2);
    assert.match(refused.stdout, /would lose: unsent input: "half a thought"/);
    assert.match(run("list").stdout, /typed ·/);
    const forced = run("close", "typed", "--force");
    assert.equal(forced.status, 0, forced.stdout + forced.stderr);
    assert.match(forced.stdout, /closed · typed/);
  });

  it("closes a clean session and it's gone from the list", () => {
    const out = run("close", "demo");
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /closed · demo/);
    assert.doesNotMatch(run("list").stdout, /^demo ·/m);
  });

  it("won't answer a trust prompt that isn't showing", () => {
    const out = run("trust", "demo-2");
    assert.equal(out.status, 1);
    assert.match(out.stderr, /isn't showing the trust prompt/);
  });
});
