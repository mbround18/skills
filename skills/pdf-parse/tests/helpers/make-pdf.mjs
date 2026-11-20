// Writes a minimal, valid PDF (Helvetica, one text run per line) so the real
// pdftotext pipeline can be tested without shipping a binary fixture.
// pages: [[{ text, size, x, top }]] — `top` is distance from the page top in pt.

const esc = (s) => s.replace(/[\\()]/g, (c) => "\\" + c);

export function makePdf(pages, { width = 432, height = 648, title = "Fixture" } = {}) {
  const objs = [];
  const add = (body) => objs.push(body) && objs.length;
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Title (${esc(title)}) >>`);
  const kids = [];
  for (const lines of pages) {
    const stream = lines.map((l) => `BT /F1 ${l.size} Tf ${l.x ?? 54} ${height - l.top} Td (${esc(l.text)}) Tj ET`).join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** A three-page "report": running header + folio on every page, two heading levels, a footnote, a paragraph split across a page break. */
export function samplePages() {
  const header = (n) => [
    { text: "ACME FIELD REPORT", size: 8, top: 30 },
    { text: String(n), size: 8, x: 380, top: 620 },
  ];
  const body = (top, text) => ({ text, size: 11, top });
  return [
    [
      ...header(1),
      { text: "Field Notes", size: 24, top: 90 },
      { text: "Getting Started", size: 16, top: 140 },
      body(170, "Every expedition begins with a careful inventory of"),
      body(184, "equipment and a plan for the first three days. Pack light but"),
      body(198, "never skip the essentials, because the nearest road can be a full"),
      body(212, "day away. Check every strap and buckle twice before leaving camp."),
      { text: "Supplies", size: 16, top: 240 },
      body(270, "Water filters, maps, and a compass are essential. A spare"),
      body(284, "battery pack keeps the radio working when the weather"),
      { text: "1 Ranger handbook, 2019 edition, https://example.org/handbook.", size: 8, top: 560 },
    ],
    [
      ...header(2),
      body(70, "turns and the trail disappears under fresh snow."),
      { text: "Field Notes", size: 24, top: 120 },
      { text: "Navigation", size: 16, top: 170 },
      body(200, "Triangulate from two landmarks before committing to a route."),
    ],
    [
      ...header(3),
      { text: "Field Notes", size: 24, top: 90 },
      { text: "Camp", size: 16, top: 140 },
      body(170, "Pitch the tent on high ground, away from dead branches."),
    ],
  ];
}
