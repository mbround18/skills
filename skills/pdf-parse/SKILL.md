---
name: pdf-parse
description: Converts any text-based PDF (books, papers, manuals, datasheets, reports) into LLM- and index-ready output — clean Markdown with real heading levels and page markers, plus heading-aware JSONL chunks carrying section path, page span and a citation context line. Strips running headers, folios and page numbers, separates footnotes, rejoins hyphenated words and sentences split across pages. Use when the user wants to read, summarise, search, chunk, embed, index or build RAG/a knowledge base from a PDF, or asks for a PDF "in a format an LLM can use".
license: BSD-3-Clause
compatibility: Node.js 18+ and pdftotext from poppler-utils. Scanned (image-only) PDFs need OCR first.
metadata:
  author: mbround18
user-invocable: true
argument-hint: "<file.pdf> [--pages a-b] [--out dir]"
---

# pdf-parse

Turns a PDF into three files an agent or a vector index can use directly.
No dependencies beyond poppler's `pdftotext`; parsing is deterministic and
takes well under a second for a 200-page book.

```bash
node scripts/pdf-parse.mjs <file.pdf> [more.pdf ...] [--out <dir>] [--pages 10-42] [--target 220] [--max 400] [--no-notes] [--stdout]
```

Run it from this skill's directory, or give the script's absolute path.
Output goes to `<out>/<slug>/` (default `./pdf-parse-out/<slug>/`):

| File | What it is |
|---|---|
| `document.md` | The whole document as Markdown. `#` is the title, detected headings follow as `##`…, `<!-- page N -->` marks page starts, footnotes appear as `> [note] …`. |
| `chunks.jsonl` | One chunk per line: `id`, `doc`, `title`, `kind` (`text` or `note`), `section` (heading path), `pages` `[from, to]` (PDF pages), `printed` `[from, to]` (the page numbers printed on the page, when the PDF has them — cite these), `context` (`"Title › Chapter › Section (pp. 12–13)"`), `words`, `text`. |
| `manifest.json` | Source file and sha256, page count, metadata, chunk and word counts, detection stats, and `warnings`. |

## Workflow

1. **Parse.** Run the script. For a big document you only need part of,
   pass `--pages` — page numbers in the output stay the PDF's real ones.
2. **Check the manifest first.** If `warnings` mentions OCR, the PDF has no
   text layer: tell the user and suggest `ocrmypdf in.pdf out.pdf`, then
   re-run on the OCR'd file. Don't guess at content.
3. **Skim headings** to confirm structure: `grep '^#' document.md`. If
   headings look wrong (everything flat, or table-of-contents lines),
   structure detection fell back to plain paragraphs — chunks are still
   usable, `section` is just less informative.
4. **Use the right file for the job:**
   - *Reading or summarising* → `document.md`, section by section; don't load
     a whole book into context when a chapter will do.
   - *Search / RAG / embeddings* → `chunks.jsonl`. Embed `context + "\n\n" + text`
     so each vector knows where it came from; keep `id` and `pages` for
     citations.
   - *Quick lookup* → `grep -i "<term>" chunks.jsonl` and read the hits'
     `context`.
5. **Cite** answers with the chunk's `context` (title, section, page),
   preferring `printed` page numbers when present.

## Tuning

- `--target` / `--max` set chunk size in words (soft target, hard cap).
  ~200 suits embeddings; raise to 500–800 for long-context summarisation.
- Chunks never cross a top-level heading; tiny sections merge into the
  next one so there are no fragment chunks.
- `--no-notes` drops footnote chunks (they stay in `document.md`).
- `--stdout` prints JSONL only, for piping.

## Limits

- Tables come out as text in reading order, not as structured rows.
- Images and figures are skipped; captions survive as text.
- Multi-column layouts follow poppler's reading order, which is usually
  right but not always.
- Respect copyright: parsed output of a book is still the book. Keep it
  local; don't commit or publish it unless the user owns the rights.
