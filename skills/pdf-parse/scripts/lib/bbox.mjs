// Reader for `pdftotext -bbox-layout` XHTML. Poppler already groups words
// into lines and blocks in reading order; we keep that structure plus the
// geometry, which is what lets later stages tell a heading (tall line) from
// a footnote (short line near the bottom) from a running header (same text
// in the same band on many pages).

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

function attrs(tag) {
  const out = {};
  for (const [, k, v] of tag.matchAll(/(\w+)="([^"]*)"/g)) out[k] = decodeEntities(v);
  return out;
}

/**
 * Parse bbox-layout XHTML into
 * { meta: {title, author, ...}, pages: [{ number, width, height, blocks: [{ lines: [{ text, x, y, x2, y2, h }] }] }] }
 */
export function parseBboxHtml(html, { firstPage = 1 } = {}) {
  const meta = {};
  const title = html.match(/<title>([\s\S]*?)<\/title>/);
  // Some producers leave markup in the metadata title ("Arm<Sup>®</Sup>").
  if (title) meta.title = decodeEntities(title[1]).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  for (const [, tag] of html.matchAll(/<meta ([^>]*)\/?>/g)) {
    const a = attrs(tag);
    if (a.name && a.content) meta[a.name.toLowerCase()] = a.content;
  }

  const pages = [];
  const pageRe = /<page ([^>]*)>([\s\S]*?)<\/page>/g;
  for (const [, pageTag, pageBody] of html.matchAll(pageRe)) {
    const pa = attrs(pageTag);
    const page = { number: firstPage + pages.length, width: +pa.width, height: +pa.height, blocks: [] };
    for (const [, , blockBody] of pageBody.matchAll(/<block ([^>]*)>([\s\S]*?)<\/block>/g)) {
      const lines = [];
      for (const [, lineTag, lineBody] of blockBody.matchAll(/<line ([^>]*)>([\s\S]*?)<\/line>/g)) {
        const la = attrs(lineTag);
        const words = [...lineBody.matchAll(/<word [^>]*>([\s\S]*?)<\/word>/g)].map((m) => decodeEntities(m[1]));
        const text = words.join(" ").trim();
        if (!text) continue;
        const y = +la.yMin;
        const y2 = +la.yMax;
        lines.push({ text, x: +la.xMin, y, x2: +la.xMax, y2, h: +(y2 - y).toFixed(2) });
      }
      if (lines.length) page.blocks.push({ lines });
    }
    pages.push(page);
  }
  return { meta, pages };
}
