#!/usr/bin/env node
// pdf-parse: PDF → Markdown + JSONL chunks + manifest, ready for an LLM or
// a vector index.
//
//   node scripts/pdf-parse.mjs <file.pdf> [more.pdf ...]
//        [--out <dir>]          output root (default ./pdf-parse-out)
//        [--pages 10-42]        page range
//        [--target 220]         words per chunk (soft)
//        [--max 400]            words per chunk (hard, except one long sentence)
//        [--no-notes]           drop footnote chunks
//        [--stdout]             print JSONL chunks instead of writing files
//
// Writes <out>/<slug>/{document.md, chunks.jsonl, manifest.json}.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

import { parseBboxHtml } from "./lib/bbox.mjs";
import { chunk, structure } from "./lib/structure.mjs";

export function slugify(name) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[’']/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "document"
  );
}

/** Run poppler's pdftotext in bbox mode. */
export function extractBbox(pdfPath, { from, to } = {}) {
  const args = ["-bbox-layout", "-enc", "UTF-8"];
  if (from) args.push("-f", String(from));
  if (to) args.push("-l", String(to));
  try {
    return execFileSync("pdftotext", [...args, pdfPath, "-"], { maxBuffer: 1024 * 1024 * 1024 }).toString("utf8");
  } catch (err) {
    if (err.code === "ENOENT") throw new Error("pdftotext not found — install poppler-utils (apt install poppler-utils / brew install poppler)");
    throw new Error(`pdftotext failed on ${pdfPath}: ${err.stderr?.toString().trim() || err.message}`);
  }
}

/** bbox XHTML → { doc, elements, chunks, stats }. Pure: tests feed it XHTML directly. */
export function parseDocument(html, { name = "document", firstPage = 1, target, max, includeNotes = true } = {}) {
  const { meta, pages } = parseBboxHtml(html, { firstPage });
  const { elements, labels, stats } = structure(pages);
  const title = meta.title?.trim() || name;
  const slug = slugify(name);
  const chunks = chunk(elements, { target, max, includeNotes }).map((c, i) => {
    const pages = c.pages[0] === c.pages[1] ? `p. ${c.pages[0]}` : `pp. ${c.pages[0]}–${c.pages[1]}`;
    return {
      id: `${slug}:${String(i + 1).padStart(4, "0")}`,
      doc: slug,
      title,
      kind: c.kind,
      section: c.section,
      pages: c.pages,
      // Printed page numbers, when the PDF has them: cite these.
      ...(labels[c.pages[0]] ? { printed: [labels[c.pages[0]], labels[c.pages[1]] ?? null] } : {}),
      // A ready-made header for embedding or prompting: where this text lives.
      context: [title, ...c.section].join(" › ") + ` (${pages})`,
      words: (c.text.match(/\S+/g) ?? []).length,
      text: c.text,
    };
  });
  const chars = pages.reduce((n, p) => n + p.blocks.reduce((m, b) => m + b.lines.reduce((k, l) => k + l.text.length, 0), 0), 0);
  return {
    doc: { slug, title, author: meta.author ?? null, pages: pages.length, firstPage },
    elements,
    labels,
    chunks,
    stats: { ...stats, chars, charsPerPage: pages.length ? Math.round(chars / pages.length) : 0 },
  };
}

/** Elements → Markdown with page markers, footnotes kept as a list under their page. */
export function toMarkdown(parsed) {
  const out = [`# ${parsed.doc.title}`, ""];
  let page = null;
  for (const el of parsed.elements) {
    if (el.page !== page) {
      page = el.page;
      out.push(parsed.labels?.[page] ? `<!-- page ${page} (printed ${parsed.labels[page]}) -->` : `<!-- page ${page} -->`, "");
    }
    if (el.type === "heading") out.push(`${"#".repeat(Math.min(6, el.level + 1))} ${el.text}`, "");
    else if (el.type === "note") out.push(`> [note] ${el.text}`, "");
    else out.push(el.text, "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

export function toJsonl(chunks) {
  return chunks.map((c) => JSON.stringify(c)).join("\n") + (chunks.length ? "\n" : "");
}

export function parseRange(s) {
  const m = /^(\d+)?(?:-(\d+)?)?$/.exec(s ?? "");
  if (!s || !m) throw new Error(`bad --pages "${s}" (use 5, 5-20, 5- or -20)`);
  const from = m[1] ? +m[1] : undefined;
  const to = s.includes("-") ? (m[2] ? +m[2] : undefined) : from;
  return { from, to };
}

export function parseArgs(argv) {
  const a = { files: [], out: "pdf-parse-out", pages: null, target: 220, max: 400, notes: true, stdout: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--out") a.out = argv[++i];
    else if (v === "--pages") a.pages = parseRange(argv[++i]);
    else if (v === "--target") a.target = +argv[++i];
    else if (v === "--max") a.max = +argv[++i];
    else if (v === "--no-notes") a.notes = false;
    else if (v === "--stdout") a.stdout = true;
    else if (v.startsWith("--")) throw new Error(`unknown option ${v}`);
    else a.files.push(v);
  }
  return a;
}

/** Parse one PDF and write its outputs. Returns the manifest. */
export function parseFile(pdfPath, opts) {
  if (!existsSync(pdfPath)) throw new Error(`no such file: ${pdfPath}`);
  const name = basename(pdfPath, extname(pdfPath));
  const html = extractBbox(pdfPath, opts.pages ?? {});
  const parsed = parseDocument(html, { name, firstPage: opts.pages?.from ?? 1, target: opts.target, max: opts.max, includeNotes: opts.notes });
  const manifest = {
    source: { file: basename(pdfPath), sha256: createHash("sha256").update(readFileSync(pdfPath)).digest("hex") },
    ...parsed.doc,
    chunks: parsed.chunks.length,
    words: parsed.chunks.reduce((n, c) => n + c.words, 0),
    stats: parsed.stats,
    format: { chunks: "chunks.jsonl — one JSON object per line: id, doc, title, kind (text|note), section[], pages[from,to], printed[from,to] (printed page numbers, when found), context, words, text", markdown: "document.md" },
    warnings: [],
  };
  if (parsed.stats.charsPerPage < 30) manifest.warnings.push("little or no text layer — this looks scanned; OCR it first (e.g. ocrmypdf) and re-run");
  if (opts.stdout) return { manifest, jsonl: toJsonl(parsed.chunks) };
  const dir = join(resolve(opts.out), parsed.doc.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "document.md"), toMarkdown(parsed));
  writeFileSync(join(dir, "chunks.jsonl"), toJsonl(parsed.chunks));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return { manifest, dir };
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (!opts.files.length) {
    console.log("usage: pdf-parse.mjs <file.pdf> [...] [--out dir] [--pages a-b] [--target n] [--max n] [--no-notes] [--stdout]");
    process.exitCode = 2;
    return;
  }
  for (const f of opts.files) {
    const { manifest, dir, jsonl } = parseFile(resolve(f), opts);
    if (jsonl !== undefined) process.stdout.write(jsonl);
    else console.log(`${manifest.source.file}: ${manifest.pages} pages → ${manifest.chunks} chunks, ${manifest.words} words → ${dir}`);
    for (const w of manifest.warnings) console.error(`warning: ${manifest.source.file}: ${w}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(`pdf-parse: ${err.message}`);
    process.exitCode = 1;
  }
}
