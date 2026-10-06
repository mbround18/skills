import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import {
  PAUSE_GRACE_MS,
  decideMode,
  describeAge,
  noteStamp,
  parseAheadBehind,
  parseStatus,
  render,
  snapshot,
  stampLine,
} from "../scripts/snapshot.mjs";

const T0 = new Date("2026-10-06T22:00:00Z");
const at = (ms) => new Date(T0.getTime() + ms);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("noteStamp", () => {
  it("reads the ISO stamp comment", () => {
    const text = `${stampLine(T0)}\n# Tomorrow\n`;
    assert.equal(noteStamp(text).toISOString(), T0.toISOString());
  });

  it("falls back to the 'end of' day, taken as that day's start", () => {
    const stamp = noteStamp("# Tomorrow\n\nWhere X stood at the end of 2026-10-03.");
    assert.equal(stamp.toISOString(), "2026-10-03T00:00:00.000Z");
  });

  it("prefers the stamp over the prose date", () => {
    const text = `${stampLine(T0)}\nWhere X stood at the end of 2026-10-03.`;
    assert.equal(noteStamp(text).toISOString(), T0.toISOString());
  });

  it("is null for an unstamped note", () => {
    assert.equal(noteStamp("# Tomorrow\nno dates here"), null);
  });
});

describe("decideMode — time only moves forward", () => {
  it("writes when there is no note", () => {
    assert.equal(decideMode({ stamp: null, activity: at(0), now: at(HOUR) }).mode, "write");
  });

  it("picks up an hour later when the tree is as the note left it", () => {
    const d = decideMode({ stamp: T0, activity: at(-HOUR), now: at(HOUR) });
    assert.equal(d.mode, "pickup");
    assert.match(d.reason, /1 hour ago/);
  });

  it("picks up the next day and the next week just the same", () => {
    assert.equal(decideMode({ stamp: T0, activity: at(-HOUR), now: at(DAY) }).mode, "pickup");
    assert.equal(decideMode({ stamp: T0, activity: at(-HOUR), now: at(7 * DAY) }).mode, "pickup");
  });

  it("still picks up when the note was committed right after it was written", () => {
    const d = decideMode({ stamp: T0, activity: at(PAUSE_GRACE_MS - 1000), now: at(DAY) });
    assert.equal(d.mode, "pickup");
  });

  it("writes when work happened after the note", () => {
    const d = decideMode({ stamp: T0, activity: at(2 * HOUR), now: at(3 * HOUR) });
    assert.equal(d.mode, "write");
    assert.match(d.reason, /after the note/);
  });

  it("writes, and complains, when the note is stamped in the future", () => {
    const d = decideMode({ stamp: at(DAY), activity: at(-HOUR), now: T0 });
    assert.equal(d.mode, "write");
    assert.match(d.reason, /clock is wrong/);
  });

  it("picks up with no activity at all (an empty repo with a note)", () => {
    assert.equal(decideMode({ stamp: T0, activity: null, now: at(HOUR) }).mode, "pickup");
  });
});

describe("describeAge", () => {
  it("speaks in the largest sensible unit", () => {
    assert.equal(describeAge(45 * 60_000), "45 minutes");
    assert.equal(describeAge(1 * HOUR), "1 hour");
    assert.equal(describeAge(30 * HOUR), "30 hours");
    assert.equal(describeAge(3 * DAY), "3 days");
    assert.equal(describeAge(21 * DAY), "3 weeks");
  });
});

describe("git output parsing", () => {
  it("parses porcelain status", () => {
    assert.deepEqual(parseStatus(" M a.ts\n?? b/c.md\n"), [
      { status: " M", path: "a.ts" },
      { status: "??", path: "b/c.md" },
    ]);
    assert.deepEqual(parseStatus(""), []);
    assert.deepEqual(parseStatus(null), []);
  });

  it("parses ahead/behind counts", () => {
    assert.deepEqual(parseAheadBehind("2\t37"), { behind: 2, ahead: 37 });
    assert.equal(parseAheadBehind(null), null);
    assert.equal(parseAheadBehind("fatal"), null);
  });
});

describe("snapshot on a real repository", () => {
  let repo;
  const sh = (args, env = {}) =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
        ...env,
      },
    });

  before(() => {
    repo = mkdtempSync(join(tmpdir(), "tomorrow-test-"));
    sh(["init", "-q", "-b", "main"]);
    sh(["config", "commit.gpgsign", "false"]);
    writeFileSync(join(repo, "a.txt"), "a\n");
    sh(["add", "a.txt"]);
    const when = T0.toISOString();
    sh(["commit", "-q", "-m", "first"], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
  });

  after(() => rmSync(repo, { recursive: true, force: true }));

  it("reports a clean tree with no note as write", () => {
    const snap = snapshot(repo, at(HOUR));
    assert.equal(snap.git, true);
    assert.equal(snap.branch, "main");
    assert.match(snap.head, /^[0-9a-f]+ N first$/);
    assert.deepEqual(snap.dirty, []);
    assert.equal(snap.hasNote, false);
    assert.equal(snap.decision.mode, "write");
    assert.match(render(snap), /tree     clean/);
    assert.match(render(snap), /mode     write/);
  });

  it("resumes from a stamped note the next day when nothing moved", () => {
    writeFileSync(join(repo, "TOMORROW.md"), `${stampLine(at(HOUR))}\n# Tomorrow\n`);
    const snap = snapshot(repo, at(DAY));
    assert.equal(snap.decision.mode, "pickup");
    // The note itself being untracked does not count as movement.
    assert.deepEqual(snap.dirty.map((d) => d.path), ["TOMORROW.md"]);
    assert.match(render(snap), /note     stamped 2026-10-06T23:00:00.000Z/);
  });

  it("writes once a file is edited after the note", () => {
    const edited = join(repo, "a.txt");
    writeFileSync(edited, "changed\n");
    const later = at(DAY + HOUR);
    utimesSync(edited, later, later);
    const snap = snapshot(repo, at(DAY + 2 * HOUR));
    assert.equal(snap.decision.mode, "write");
    assert.match(snap.decision.reason, /after the note/);
  });

  it("is honest about a directory that is not a repository", () => {
    const plain = mkdtempSync(join(tmpdir(), "tomorrow-plain-"));
    try {
      const snap = snapshot(plain);
      assert.equal(snap.git, false);
      assert.match(render(snap), /not a git repository/);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
