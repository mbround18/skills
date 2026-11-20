// Layout → document structure, with no knowledge of any particular book.
//
//   1. furniture   running headers/footers and folios: short lines in the top
//                  or bottom band whose digit-normalised text recurs on
//                  several pages, or that are bare page numbers.
//   2. body size   the most common line height, weighted by characters.
//   3. headings    short blocks set noticeably larger than body text;
//                  distinct sizes rank into levels 1–6.
//   4. notes       small text in the lower part of a page (footnotes).
//   5. paragraphs  poppler blocks, de-hyphenated, merged across page breaks
//                  when a sentence obviously continues.

const BAND = 0.09; // top/bottom fraction of the page treated as header/footer territory
const FOLIO = /^(page\s+)?(\d{1,4}|[ivxlcdm]{1,7})(\s+of\s+\d+)?$/i;

// Digits and separators ("|", "•", dashes) vary between pages of the same
// running head ("18 | FIELD GUIDE", "| FIELD GUIDE"), so they are folded away.
export const furnitureKey = (text) =>
  text.toLowerCase().replace(/\d+/g, "#").replace(/[|│•·–—]/g, " ").replace(/\s+/g, " ").trim();

function inBand(line, page) {
  return line.y2 < page.height * BAND + 30 && line.y < page.height * BAND || line.y > page.height * (1 - BAND);
}

/** Find recurring header/footer lines. Returns a Set of furniture keys. */
export function findFurniture(pages, { minPages = 3 } = {}) {
  const seen = new Map();
  for (const page of pages) {
    const keys = new Set();
    for (const b of page.blocks) for (const l of b.lines) if (l.text.length <= 80 && inBand(l, page)) keys.add(furnitureKey(l.text));
    for (const k of keys) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const threshold = Math.max(minPages, Math.ceil(pages.length * 0.05));
  return new Set([...seen].filter(([, n]) => n >= threshold).map(([k]) => k));
}

export function isFurniture(line, page, furniture) {
  if (!inBand(line, page)) return false;
  const key = furnitureKey(line.text);
  return FOLIO.test(line.text) || key === "" || furniture.has(key) || furniture.has(key.replace(/^# |\s#$/g, ""));
}

const LABEL = /^(\d{1,4}|[ivxlcdm]{1,7})$/i;

export function romanToInt(s) {
  const v = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let n = 0;
  const t = s.toLowerCase();
  for (let i = 0; i < t.length; i++) n += v[t[i]] < (v[t[i + 1]] ?? 0) ? -v[t[i]] : v[t[i]];
  return n;
}

export function intToRoman(n) {
  const table = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let out = "";
  for (const [v, r] of table) while (n >= v) (out += r), (n -= v);
  return out;
}

/**
 * Printed page numbers ("folios"), which rarely match the PDF's own page
 * index. Bare numbers in the header/footer band are candidates; a page with
 * exactly one is trusted when a neighbouring trusted page agrees on the
 * offset, and pages with none (chapter openers, blanks) or several (a
 * chapter number beside the folio) are filled in when the pages on either
 * side agree. Returns { [pdfPage]: "label" } for the pages it could settle.
 */
export function pageLabels(pages) {
  const parse = (t) => (/^\d+$/.test(t) ? { kind: "arabic", n: +t } : { kind: "roman", n: romanToInt(t) });
  const show = ({ kind, n }) => (kind === "arabic" ? String(n) : intToRoman(n));
  const cands = pages.map((p) => {
    const out = [];
    for (const b of p.blocks) for (const l of b.lines) if (LABEL.test(l.text) && inBand(l, p)) out.push(parse(l.text));
    return out;
  });
  const offset = (c, i) => `${c.kind}:${c.n - i}`;

  const single = cands.map((c) => (c.length === 1 ? c[0] : null));
  const trusted = single.map((c, i) => {
    if (!c) return null;
    const near = (dir) => {
      for (let j = i + dir; j >= 0 && j < single.length; j += dir) if (single[j]) return offset(single[j], j);
      return null;
    };
    return near(-1) === offset(c, i) || near(1) === offset(c, i) ? c : null;
  });

  const labels = {};
  for (let i = 0; i < pages.length; i++) {
    let c = trusted[i];
    if (!c) {
      const find = (dir) => {
        for (let j = i + dir; j >= 0 && j < trusted.length; j += dir) if (trusted[j]) return { kind: trusted[j].kind, n: trusted[j].n + (i - j) };
        return null;
      };
      const before = find(-1);
      const after = find(1);
      // A printed number that either neighbour predicts wins (the first page
      // of chapter 1 sits between roman front matter and arabic body); a page
      // with no number is filled only when both sides agree.
      const agrees = (g) => g && cands[i].some((x) => offset(x, 0) === offset(g, 0));
      let guess = [after, before].find(agrees) ?? null;
      if (!guess && cands[i].length === 0) guess = before && after ? (offset(before, 0) === offset(after, 0) ? before : null) : before ?? after;
      if (guess && guess.n > 0) c = guess;
    }
    if (c) labels[pages[i].number] = show(c);
  }
  return labels;
}

/** Character-weighted mode of line heights, rounded to 0.5pt. */
export function bodySize(pages) {
  const weight = new Map();
  for (const p of pages) for (const b of p.blocks) for (const l of b.lines) {
    const h = Math.round(l.h * 2) / 2;
    weight.set(h, (weight.get(h) ?? 0) + l.text.length);
  }
  let best = 0;
  let size = 10;
  for (const [h, w] of weight) if (w > best) (best = w), (size = h);
  return size;
}

/** Join wrapped lines: drop end-of-line hyphenation before a lowercase continuation. */
export function joinLines(texts) {
  let out = "";
  for (const t of texts) {
    if (!out) out = t;
    else if (/\p{L}-$/u.test(out) && /^\p{Ll}/u.test(t)) out = out.slice(0, -1) + t;
    else out += " " + t;
  }
  return out;
}

// Table-of-contents entries: dot leaders running into a page number.
const TOC_LINE = /(\.\s?){4,}\s*\d+$/;
const ENDS_SENTENCE = /[.!?:;”"’)\]]$/;

/**
 * Turn parsed pages into a flat list of elements:
 *   { type: "heading", level, text, page }
 *   { type: "paragraph", text, page, endPage }
 *   { type: "note", text, page }
 * plus `labels`, the printed page number of each PDF page where known.
 */
export function structure(pages, { headingRatio = 1.15, noteRatio = 0.88, maxHeadingChars = 160 } = {}) {
  const furniture = findFurniture(pages);
  const body = bodySize(pages);

  // First pass: classify blocks, remember heading sizes for level ranking.
  const raw = [];
  const headingSizes = new Map(); // size → occurrences
  for (const page of pages) {
    for (const block of page.blocks) {
      const lines = block.lines.filter((l) => !isFurniture(l, page, furniture));
      if (!lines.length) continue;
      const text = joinLines(lines.map((l) => l.text));
      const size = Math.max(...lines.map((l) => l.h));
      const minSize = Math.min(...lines.map((l) => l.h));
      const isHeading =
        minSize >= body * headingRatio && lines.length <= 3 && text.length <= maxHeadingChars && !/[.,;]$/.test(text) && /\p{L}/u.test(text) && !TOC_LINE.test(text);
      const isNote = !isHeading && size <= body * noteRatio && lines[0].y > page.height * 0.6;
      if (isHeading) headingSizes.set(Math.round(size * 2) / 2, (headingSizes.get(Math.round(size * 2) / 2) ?? 0) + 1);
      const band = lines.length === 1 && inBand(lines[0], page);
      raw.push({ kind: isHeading ? "heading" : isNote ? "note" : "paragraph", text, size, band, page: page.number });
    }
  }

  const ranked = rankHeadingSizes(headingSizes);
  const levelOf = (size) => Math.min(6, 1 + ranked.filter((r) => r > Math.round(size * 2) / 2 + 0.25).length);

  // Close gaps so the levels actually used are 1, 2, 3… with no holes.
  const used = [...new Set(raw.filter((r) => r.kind === "heading").map((r) => levelOf(r.size)))].sort((a, b) => a - b);
  const dense = (size) => used.indexOf(levelOf(size)) + 1;

  // Running heads that repeat a heading ("SOIL AND WATER" over that chapter) recur
  // on too few pages to count as furniture, so match them to the headings.
  const headingKeys = new Set(raw.filter((r) => r.kind === "heading").map((r) => furnitureKey(r.text)));
  const isRunningHead = (r) => r.kind === "paragraph" && r.band && headingKeys.has(furnitureKey(r.text));

  const elements = [];
  for (const r of raw) {
    if (isRunningHead(r)) continue;
    if (r.kind === "heading") {
      elements.push({ type: "heading", level: dense(r.size), text: r.text, page: r.page });
    } else if (r.kind === "note") {
      // A note that wrapped into another block continues the previous note.
      const last = elements.at(-1);
      if (last?.type === "note" && last.page === r.page && !/^(\d{1,3}|[*†‡§¶])\s/.test(r.text)) last.text = joinLines([last.text, r.text]);
      else elements.push({ type: "note", text: r.text, page: r.page });
    } else {
      // Continue a paragraph cut by a page break (or by a note/figure between).
      const prev = [...elements].reverse().find((e) => e.type !== "note");
      if (prev?.type === "paragraph" && r.page > prev.endPage && !ENDS_SENTENCE.test(prev.text) && /^\p{Ll}/u.test(r.text)) {
        prev.text = joinLines([prev.text, r.text]);
        prev.endPage = r.page;
      } else {
        elements.push({ type: "paragraph", text: r.text, page: r.page, endPage: r.page });
      }
    }
  }
  return { elements, labels: pageLabels(pages), stats: { bodySize: body, headingSizes: ranked, furniture: [...furniture] } };
}

/**
 * Heading sizes that structure the document. Sizes used only once or twice
 * (cover titles, a one-off display line) would otherwise claim the top
 * levels and push every real heading down to h6, so they are left out of the
 * ranking — a rare size still gets the level of the next common size below
 * it, or level 1 if it is larger than all of them.
 */
export function rankHeadingSizes(counts, { minCount = 3 } = {}) {
  const all = [...counts.keys()].sort((a, b) => b - a);
  const common = all.filter((s) => counts.get(s) >= minCount);
  return common.length ? common : all;
}

/** Sentence split that avoids common abbreviations and figure numbers. */
export function sentences(text) {
  return text
    .split(/(?<!\b(?:e\.g|i\.e|etc|vs|Fig|Figure|No|Dr|Mr|Ms|Mrs|St|al)\.)(?<=[.!?][”"’)\]]?)\s+(?=[\p{Lu}“"‘(\[•\d])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

const words = (s) => (s.match(/\S+/g) ?? []).length;

/**
 * Pack elements into retrieval chunks of ~`target` words (hard cap `max`),
 * never crossing a heading unless the pending chunk is under `minWords`,
 * and never crossing a level-1 heading.
 * Each chunk carries its heading path and page span.
 */
export function chunk(elements, { target = 220, max = 400, minWords = 40, includeNotes = true } = {}) {
  const chunks = [];
  const path = [];
  let buf = [];

  const pending = () => buf.reduce((n, p) => n + words(p.text), 0);
  const flush = () => {
    if (!buf.length) return;
    chunks.push({
      kind: "text",
      section: buf[0].path,
      pages: [buf[0].page, buf.at(-1).endPage ?? buf.at(-1).page],
      text: buf.map((p) => p.text).join("\n\n"),
    });
    buf = [];
  };
  const add = (piece) => {
    if (buf.length && pending() + words(piece.text) > max) flush();
    buf.push(piece);
    if (pending() >= target) flush();
  };

  for (const el of elements) {
    if (el.type === "heading") {
      // Small sections merge into the next one, but never across a chapter.
      if (el.level === 1 || pending() >= minWords) flush();
      path.splice(el.level - 1);
      path[el.level - 1] = el.text;
      for (let i = 0; i < path.length; i++) path[i] ??= "";
      continue;
    }
    if (el.type === "note") {
      if (includeNotes) chunks.push({ kind: "note", section: path.filter(Boolean), pages: [el.page, el.page], text: el.text });
      continue;
    }
    const here = path.filter(Boolean);
    if (words(el.text) <= max) {
      add({ text: el.text, page: el.page, endPage: el.endPage, path: buf.length ? buf[0].path : here });
      continue;
    }
    // Oversized paragraph: split on sentences.
    let part = [];
    for (const s of sentences(el.text)) {
      if (part.length && words(part.join(" ")) + words(s) > target) {
        add({ text: part.join(" "), page: el.page, endPage: el.endPage, path: here });
        part = [];
      }
      part.push(s);
    }
    if (part.length) add({ text: part.join(" "), page: el.page, endPage: el.endPage, path: here });
  }
  flush();
  return chunks;
}
