import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { classify, cleanUp, human, parseWorktreeList, scanRepo, unrebuildableIgnored } from "../scripts/worktrees.mjs";

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-C", cwd, "-c", "commit.gpgsign=false", ...args], { encoding: "utf8", env: gitEnv });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};

describe("parseWorktreeList", () => {
  it("reads branches, detached heads, locks and stale entries", () => {
    const out = [
      "worktree /r\nHEAD aaa\nbranch refs/heads/main",
      "worktree /r/wt/a\nHEAD bbb\nbranch refs/heads/feat/a\nlocked reason here",
      "worktree /gone\nHEAD ccc\ndetached\nprunable gitdir file points to non-existent location",
    ].join("\n\n");
    assert.deepEqual(parseWorktreeList(out), [
      { main: true, path: "/r", head: "aaa", branch: "main" },
      { main: false, path: "/r/wt/a", head: "bbb", branch: "feat/a", locked: "reason here" },
      { main: false, path: "/gone", head: "ccc", detached: true, prunable: "gitdir file points to non-existent location" },
    ]);
  });
});

describe("unrebuildableIgnored", () => {
  it("lets build output go but holds on to the rest", () => {
    const status = "!! node_modules/\n!! apps/web/dist/\n!! target/\n!! .env\n!! secrets/key.pem\n M x\n!! tsconfig.tsbuildinfo";
    assert.deepEqual(unrebuildableIgnored(status), [".env", "secrets/key.pem"]);
  });
});

describe("classify", () => {
  const base = { inUse: [], dirty: 0, keepers: [], idleDays: 1, branch: "b" };
  const action = (f) => classify({ ...base, ...f }, 14).action;
  it("never touches the main worktree, a locked one, or one in use", () => {
    assert.equal(action({ main: true, merged: "main" }), "keep");
    assert.equal(action({ locked: true, merged: "main" }), "keep");
    assert.equal(action({ inUse: ["claude 1"], merged: "main" }), "keep");
  });
  it("keeps uncommitted work and ignored files that can't be rebuilt", () => {
    assert.equal(action({ dirty: 1, merged: "main" }), "keep");
    assert.equal(action({ keepers: [".env"], merged: "main", idleDays: 99 }), "keep");
  });
  it("removes merged ones with their branch, and idle clean ones without", () => {
    assert.equal(action({ merged: "main" }), "remove+branch");
    assert.equal(action({ merged: "main", branch: undefined }), "remove");
    assert.equal(action({ idleDays: 20 }), "remove");
    assert.match(classify({ ...base, idleDays: 20 }, 14).reason, /branch b kept/);
    assert.equal(action({ idleDays: 3 }), "keep");
  });
  it("prunes registrations whose folder is gone", () => {
    assert.equal(action({ prunable: true }), "prune");
  });
  it("formats sizes", () => {
    assert.equal(human(512), "512 B");
    assert.equal(human(386 * 1024 * 1024), "386 MB");
    assert.equal(human(undefined), "?");
  });
});

describe("scanRepo and cleanUp on a real repo", () => {
  let root, repo, wt;
  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "wt-scan-")));
    repo = join(root, "repo");
    wt = (n) => join(root, "wts", n);
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, ".gitignore"), ".env\nnode_modules/\n");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "init");
    for (const n of ["merged", "ahead", "dirty", "env", "deps", "busy", "gone"]) {
      git(repo, "worktree", "add", "-q", "-b", n, wt(n));
    }
    writeFileSync(join(wt("ahead"), "f"), "x");
    git(wt("ahead"), "add", "f");
    git(wt("ahead"), "commit", "-qm", "unmerged work");
    writeFileSync(join(wt("dirty"), "wip.txt"), "x");
    writeFileSync(join(wt("env"), ".env"), "SECRET=1");
    mkdirSync(join(wt("deps"), "node_modules"));
    writeFileSync(join(wt("deps"), "node_modules", "x.js"), "x");
    rmSync(wt("gone"), { recursive: true });
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  const scan = (opts = {}) => {
    const cwds = [{ pid: 42, cwd: join(wt("busy"), "src"), comm: "claude" }];
    return Object.fromEntries(scanRepo(repo, { cwds, ...opts }).map((w) => [w.branch, w]));
  };

  it("sorts each worktree into keep, remove or prune", () => {
    const r = scan();
    assert.equal(r.main.action, "keep");
    assert.equal(r.merged.action, "remove+branch");
    assert.equal(r.ahead.action, "keep");
    assert.match(r.ahead.reason, /not merged/);
    assert.match(r.dirty.reason, /1 uncommitted change/);
    assert.match(r.env.reason, /ignored files that may matter: \.env/);
    assert.equal(r.deps.action, "remove+branch");
    assert.match(r.busy.reason, /in use \(claude 42\)/);
    assert.equal(r.gone.action, "prune");
  });

  it("treats an unmerged clean worktree as stale once it's idle long enough", () => {
    const r = scan({ now: Date.now() + 30 * 86_400_000 });
    assert.equal(r.ahead.action, "remove");
    assert.match(r.ahead.reason, /idle 30 days; branch ahead kept/);
  });

  it("removes what it said it would, keeps the branches with unmerged work", () => {
    const r = scan({ now: Date.now() + 30 * 86_400_000 });
    for (const w of Object.values(r)) cleanUp(w);
    for (const n of ["merged", "deps", "ahead"]) assert.equal(existsSync(wt(n)), false, n);
    for (const n of ["dirty", "env", "busy"]) assert.equal(existsSync(wt(n)), true, n);
    const branches = git(repo, "branch", "--format=%(refname:short)").split("\n").filter(Boolean);
    assert.ok(!branches.includes("merged") && !branches.includes("deps"), "merged branches deleted");
    assert.ok(branches.includes("ahead"), "unmerged branch kept");
    assert.doesNotMatch(git(repo, "worktree", "list"), /wts\/gone/);
  });

  it("leaves it to git to refuse a worktree that changed after the scan", () => {
    const [w] = scanRepo(repo, { cwds: [] }).filter((x) => x.branch === "dirty");
    const r = cleanUp({ ...w, action: "remove" });
    assert.equal(r.ok, false);
    assert.match(r.note, /git refused/);
    assert.equal(existsSync(wt("dirty")), true);
  });
});

describe("close cleans up its merged worktree", { skip: spawnSync("sh", ["-c", "command -v tmux"]).status !== 0 && "tmux not installed" }, () => {
  const socket = `launch-project-wt-test-${process.pid}`;
  const script = fileURLToPath(new URL("../scripts/launch.mjs", import.meta.url));
  let root, repo, env;
  before(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "wt-close-")));
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "claude"), "#!/bin/sh\necho 'at https://claude.ai/code/session_01Fake'\nexec sleep 60\n");
    chmodSync(join(bin, "claude"), 0o755);
    repo = join(root, "repo");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "commit", "-q", "--allow-empty", "-m", "init");
    git(repo, "worktree", "add", "-q", "-b", "done", join(root, "wt-done"));
    git(repo, "worktree", "add", "-q", "-b", "wip", join(root, "wt-wip"));
    git(repo, "worktree", "add", "-q", "-b", "other-done", join(root, "wt-other-done"));
    writeFileSync(join(root, "wt-wip", "f"), "x");
    git(join(root, "wt-wip"), "add", "f");
    git(join(root, "wt-wip"), "commit", "-qm", "wip");
    env = { ...gitEnv, PATH: `${bin}:${process.env.PATH}`, LAUNCH_PROJECT_TMUX_SOCKET: socket, DISPLAY: "", WAYLAND_DISPLAY: "", HOME: root };
  });
  after(() => {
    spawnSync("tmux", ["-L", socket, "kill-server"]);
    rmSync(root, { recursive: true, force: true });
  });
  const run = (...args) => spawnSync("node", [script, ...args], { encoding: "utf8", env, cwd: root });

  it("removes the worktree and its branch when the work is merged", () => {
    assert.match(run(join(root, "wt-done"), "--session-name", "done").stdout, /launched done /);
    const out = run("close", "done");
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /worktree .*wt-done removed; merged branch done deleted · freed/);
    assert.equal(existsSync(join(root, "wt-done")), false);
  });

  it("also removes other unused merged worktrees in the same repo", () => {
    assert.equal(existsSync(join(root, "wt-other-done")), false);
  });

  it("keeps a worktree with unmerged commits, and says why", () => {
    assert.match(run(join(root, "wt-wip"), "--session-name", "wip").stdout, /launched wip /);
    const out = run("close", "wip");
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /kept worktree .*wt-wip: not merged/);
    assert.equal(existsSync(join(root, "wt-wip")), true);
  });
});
