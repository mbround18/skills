import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decodeEntities, parseBboxHtml } from "../scripts/lib/bbox.mjs";
import { bodySize, chunk, findFurniture, joinLines, rankHeadingSizes, sentences, structure } from "../scripts/lib/structure.mjs";

// Build bbox-layout XHTML the way poppler prints it.
function xhtml(pages, { height = 648 } = {}) {
  const word = (w, l) => `<word xMin="${l.x}" yMin="${l.top}" xMax="${l.x + 5}" yMax="${l.top + l.size}">${w}</word>`;
  const line = (l) => `<line xMin="${l.x}" yMin="${l.top}" xMax="300" yMax="${l.top + l.size}">${l.text.split(" ").map((w) => word(w, l)).join("")}</line>`;
  const page = (blocks) => `<page width="432" height="${height}"><flow>${blocks.map((b) => `<block xMin="54">${b.map((l) => line({ x: 54, ...l })).join("")}</block>`).join("")}</flow></page>`;
  return `<html><head><title>T &amp; Co</title><meta name="Author" content="A. Writer"/></head><body><doc>${pages.map(page).join("")}</doc></body></html>`;
}

const head = (n) => [[{ text: "RUNNING HEAD", size: 8, top: 20 }], [{ text: String(n), size: 8, top: 620 }]];
const para = (top, ...texts) => texts.map((text, i) => ({ text, size: 11, top: top + i * 14 }));
const doc = xhtml([
  [...head(1), [{ text: "Chapter One", size: 24, top: 90 }], [{ text: "Section A", size: 16, top: 140 }], para(170, "Alpha beta gamma delta epsilon zeta eta.", "Theta iota kappa lambda.")],
  [...head(2), [{ text: "Section B", size: 16, top: 90 }], para(120, "Mu nu xi omicron pi rho sigma tau upsilon", "phi chi psi."), [{ text: "1 A note, 2020, https://x.y.", size: 8, top: 560 }], [{ text: "continued note text", size: 8, top: 572 }]],
  [...head(3), [{ text: "Chapter Two", size: 24, top: 90 }], para(120, "Omega closes the sample.")],
]);

describe("bbox reader", () => {
  it("decodes entities", () => {
    assert.equal(decodeEntities("a &amp; b &#8217; &#x2014; &lt;"), "a & b ’ — <");
  });

  it("reads metadata, pages, blocks and line geometry", () => {
    const { meta, pages } = parseBboxHtml(doc);
    assert.equal(meta.title, "T & Co");
    assert.equal(meta.author, "A. Writer");
    assert.equal(pages.length, 3);
    assert.equal(pages[0].blocks[2].lines[0].text, "Chapter One");
    assert.equal(pages[0].blocks[2].lines[0].h, 24);
  });

  it("numbers pages from the requested first page", () => {
    assert.equal(parseBboxHtml(doc, { firstPage: 10 }).pages[2].number, 12);
  });
});

describe("structure", () => {
  const { pages } = parseBboxHtml(doc);
  const { elements } = structure(pages);

  it("detects recurring running heads and the body size", () => {
    assert.ok(findFurniture(pages).has("running head"));
    assert.equal(bodySize(pages), 11);
  });

  it("drops running heads and folios", () => {
    assert.ok(!elements.some((e) => /RUNNING HEAD|^\d$/.test(e.text)));
  });

  it("ranks headings by size into levels", () => {
    const hs = elements.filter((e) => e.type === "heading").map((e) => [e.level, e.text]);
    assert.deepEqual(hs, [[1, "Chapter One"], [2, "Section A"], [2, "Section B"], [1, "Chapter Two"]]);
  });

  it("separates footnotes and merges a wrapped note", () => {
    const notes = elements.filter((e) => e.type === "note");
    assert.deepEqual(notes.map((n) => n.text), ["1 A note, 2020, https://x.y. continued note text"]);
  });

  it("does not mistake table-of-contents lines for headings", () => {
    const toc = parseBboxHtml(xhtml([[...head(1), [{ text: "Introduction . . . . . . . . 12", size: 16, top: 90 }], para(120, "Body text here.")], [...head(2), para(90, "More.")], [...head(3), para(90, "End.")]]));
    assert.ok(!structure(toc.pages).elements.some((e) => e.type === "heading"));
  });

  it("strips markup from the metadata title", () => {
    assert.equal(parseBboxHtml("<title>Arm&lt;Sup&gt;®&lt;/Sup&gt; MCUs</title>").meta.title, "Arm® MCUs");
  });

  it("keeps rare display sizes from claiming every level", () => {
    assert.deepEqual(rankHeadingSizes(new Map([[90, 1], [24, 5], [16, 9]])), [24, 16]);
    assert.deepEqual(rankHeadingSizes(new Map([[20, 1]])), [20]);
  });
});

describe("text helpers", () => {
  it("de-hyphenates only before a lowercase continuation", () => {
    assert.equal(joinLines(["con-", "ventions and well-", "Known"]), "conventions and well- Known");
  });

  it("splits sentences without breaking abbreviations or figure refs", () => {
    assert.deepEqual(sentences("See Fig. 2 for detail. It works, e.g. here. Done."), ["See Fig. 2 for detail.", "It works, e.g. here.", "Done."]);
  });
});

describe("chunk", () => {
  const { pages } = parseBboxHtml(doc);
  const { elements } = structure(pages);

  it("tracks the heading path and page span", () => {
    const text = chunk(elements, { minWords: 1 }).filter((c) => c.kind === "text");
    assert.deepEqual(text.map((c) => c.section), [["Chapter One", "Section A"], ["Chapter One", "Section B"], ["Chapter Two"]]);
    assert.deepEqual(text[1].pages, [2, 2]);
  });

  it("merges a too-small section into the next, but not across a chapter", () => {
    const text = chunk(elements, { minWords: 50 }).filter((c) => c.kind === "text");
    assert.deepEqual(text.map((c) => c.section), [["Chapter One", "Section A"], ["Chapter Two"]]);
  });

  it("respects the hard word cap by splitting long paragraphs on sentences", () => {
    const long = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} has six words.`).join(" ");
    const out = chunk([{ type: "paragraph", text: long, page: 1, endPage: 1 }], { target: 40, max: 60 });
    assert.ok(out.length > 1);
    assert.ok(out.every((c) => c.text.split(/\s+/).length <= 60));
  });

  it("can drop notes", () => {
    assert.ok(!chunk(elements, { includeNotes: false }).some((c) => c.kind === "note"));
  });
});
