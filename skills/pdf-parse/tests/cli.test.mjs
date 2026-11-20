import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { parseArgs, parseFile, parseRange, slugify, toJsonl } from "../scripts/pdf-parse.mjs";
import { makePdf, samplePages } from "./helpers/make-pdf.mjs";

const hasPoppler = spawnSync("pdftotext", ["-v"]).error === undefined;

describe("arguments", () => {
  it("parses page ranges", () => {
    assert.deepEqual(parseRange("5"), { from: 5, to: 5 });
    assert.deepEqual(parseRange("5-20"), { from: 5, to: 20 });
    assert.deepEqual(parseRange("5-"), { from: 5, to: undefined });
    assert.deepEqual(parseRange("-20"), { from: undefined, to: 20 });
    assert.throws(() => parseRange("x"), /bad --pages/);
  });

  it("parses flags and rejects unknown ones", () => {
    const a = parseArgs(["a.pdf", "--out", "o", "--pages", "2-3", "--target", "100", "--no-notes"]);
    assert.deepEqual([a.files, a.out, a.pages, a.target, a.notes], [["a.pdf"], "o", { from: 2, to: 3 }, 100, false]);
    assert.throws(() => parseArgs(["--nope"]), /unknown option/);
  });

  it("slugifies file names", () => {
    assert.equal(slugify("Field Guide (2nd Ed.)"), "field-guide-2nd-ed");
    assert.equal(slugify("Café’s Menu"), "cafes-menu");
    assert.equal(slugify("!!!"), "document");
  });

  it("emits JSONL with a trailing newline, or nothing", () => {
    assert.equal(toJsonl([{ a: 1 }, { b: 2 }]), '{"a":1}\n{"b":2}\n');
    assert.equal(toJsonl([]), "");
  });
});

describe("end to end through pdftotext", { skip: !hasPoppler && "pdftotext not installed" }, () => {
  let dir, pdf;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "pdf-parse-"));
    pdf = join(dir, "Field Report.pdf");
    writeFileSync(pdf, makePdf(samplePages(), { title: "Field Report" }));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("writes document.md, chunks.jsonl and manifest.json", () => {
    const { manifest, dir: outDir } = parseFile(pdf, { out: join(dir, "out"), target: 220, max: 400, notes: true });
    assert.equal(manifest.pages, 3);
    assert.equal(manifest.title, "Field Report");
    assert.equal(manifest.warnings.length, 0);

    const md = readFileSync(join(outDir, "document.md"), "utf8");
    assert.match(md, /^## Field Notes$/m);
    assert.match(md, /^### Supplies$/m);
    assert.doesNotMatch(md, /ACME FIELD REPORT/);

    const chunks = readFileSync(join(outDir, "chunks.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const supplies = chunks.find((c) => c.text.includes("Water filters"));
    // The sentence that crosses the page break is stitched back together.
    assert.match(supplies.text, /when the weather turns and the trail disappears/);
    assert.deepEqual(supplies.section, ["Field Notes", "Supplies"]);
    assert.deepEqual(supplies.pages, [1, 2]);
    assert.deepEqual(supplies.printed, ["1", "2"]);
    assert.match(supplies.context, /^Field Report › Field Notes › Supplies \(pp\. 1–2\)$/);
    assert.ok(chunks.some((c) => c.kind === "note" && c.text.includes("Ranger handbook")));
    assert.equal(new Set(chunks.map((c) => c.id)).size, chunks.length);
  });

  it("is deterministic", () => {
    const a = parseFile(pdf, { stdout: true, target: 220, max: 400, notes: true }).jsonl;
    const b = parseFile(pdf, { stdout: true, target: 220, max: 400, notes: true }).jsonl;
    assert.equal(a, b);
  });

  it("honours a page range with real page numbers", () => {
    const { jsonl } = parseFile(pdf, { stdout: true, pages: { from: 3, to: 3 }, target: 220, max: 400, notes: true });
    const chunks = jsonl.trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(chunks.every((c) => c.pages[0] === 3));
  });

  it("warns when a PDF has no text layer", () => {
    const blank = join(dir, "blank.pdf");
    writeFileSync(blank, makePdf([[]]));
    assert.match(parseFile(blank, { stdout: true, notes: true }).manifest.warnings[0], /OCR/);
  });

  it("runs as a CLI", () => {
    const out = execFileSync(process.execPath, [new URL("../scripts/pdf-parse.mjs", import.meta.url).pathname, pdf, "--stdout"]).toString();
    assert.ok(out.trim().split("\n").every((l) => JSON.parse(l).id.startsWith("field-report:")));
  });
});

describe("run as a script", () => {
  it("runs when invoked through a symlink, as an installed skill is", () => {
    const dir = mkdtempSync(join(tmpdir(), "pdf-parse-link-"));
    try {
      const link = join(dir, "pdf-parse.mjs");
      symlinkSync(fileURLToPath(new URL("../scripts/pdf-parse.mjs", import.meta.url)), link);
      const run = spawnSync("node", [link], { encoding: "utf8" });
      assert.match(run.stdout, /usage: pdf-parse\.mjs/);
      assert.equal(run.status, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
