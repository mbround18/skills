# pdf-parse

Turn any PDF into something an LLM can actually use.

pdf-parse reads a PDF's text layer with poppler and rebuilds the document's
structure from the page geometry: it works out which lines are running
headers and page numbers (and drops them), which are headings and at what
level, which are footnotes, and which paragraphs were split across a page
break or hyphenated at a line end. You get back:

- **`document.md`** — clean Markdown with real heading levels and page
  markers, good for reading or summarising.
- **`chunks.jsonl`** — ~200-word, heading-aware chunks, each tagged with its
  section path and page span and a ready-made citation line, good for
  embeddings, RAG and search.
- **`manifest.json`** — source hash, page count, stats and warnings (for
  example, "this looks scanned; OCR it first").

It is generic: no per-publisher rules. It has been checked on an O'Reilly
book, a Maxim datasheet and an ST reference manual.

## Requirements

- Node.js 18 or newer
- `pdftotext` from poppler (`apt install poppler-utils` or `brew install poppler`)
- For scanned PDFs, an OCR step first (e.g. `ocrmypdf`)

No npm dependencies.

## Install

```sh
git clone git@github.com:mbround18/skills.git
cd skills
pnpm install
pnpm run install:pdf-parse          # links into ~/.claude/skills
```

## Use

```sh
node skills/pdf-parse/scripts/pdf-parse.mjs report.pdf
# report.pdf: 42 pages → 118 chunks, 21034 words → ./pdf-parse-out/report

node skills/pdf-parse/scripts/pdf-parse.mjs manual.pdf --pages 120-180 --out ~/notes/parsed
node skills/pdf-parse/scripts/pdf-parse.mjs paper.pdf --stdout | jq -r .context
```

A chunk:

```json
{"id":"field-report:0003","doc":"field-report","title":"Field Report","kind":"text",
 "section":["Field Notes","Supplies"],"pages":[1,2],
 "context":"Field Report › Field Notes › Supplies (pp. 1–2)","words":27,
 "text":"Water filters, maps, and a compass are essential. …"}
```

Options: `--out <dir>`, `--pages a-b`, `--target <words>`, `--max <words>`,
`--no-notes`, `--stdout`.

With the skill installed, just ask your agent: "parse this PDF so you can
search it", "summarise chapter 3 of ~/Downloads/spec.pdf".

## Limits

Tables become text in reading order; images are skipped; complex
multi-column layouts depend on poppler's reading order.

## Tests

```sh
pnpm --filter pdf-parse test
```

The end-to-end tests generate a small PDF in code and run it through the
real `pdftotext`; they are skipped if poppler isn't installed.
