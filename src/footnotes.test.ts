import assert from "node:assert/strict";
import test from "node:test";
import { renderInlines, sectionArticle, type HtmlContext } from "./html.js";
import type { OutputFlavor, Publication, Section } from "./model.js";

const context = (flavor: OutputFlavor): HtmlContext => ({
  flavor,
  assets: new Map(),
  chapterFile: (id) => `${id}.html`,
  assetPrefix: "assets/",
});

const section: Section = {
  id: "ch1",
  role: "bodymatter",
  title: [{ type: "text", value: "Chapter One" }],
  blocks: [
    { type: "blockquote", blocks: [
      { type: "paragraph", children: [
        { type: "text", value: "Quoted" },
        { type: "footnote", id: "ch1-fn-1", blocks: [{ type: "paragraph", children: [{ type: "text", value: "First note" }] }] },
      ] },
    ] },
    { type: "paragraph", children: [
      { type: "text", value: "Prose" },
      { type: "footnote", id: "ch1-fn-2", blocks: [{ type: "paragraph", children: [{ type: "text", value: "Second note" }] }] },
    ] },
  ],
};

const publication: Publication = {
  schemaVersion: 1,
  id: "book",
  metadata: { title: "Test", language: "en", authors: ["Author"] },
  spine: [section],
  assets: [],
};

for (const flavor of ["web", "epub"] as const) {
  test(`footnotes render once at section end for ${flavor}`, () => {
    const html = sectionArticle(section, publication, context(flavor));
    const sections = html.match(/<section class="footnotes"/g) ?? [];
    assert.equal(sections.length, 1, "expected exactly one footnotes section");
    const blockquote = html.slice(html.indexOf("<blockquote>"), html.indexOf("</blockquote>"));
    assert.ok(!blockquote.includes(`class="footnotes"`), "footnotes must not be inside the blockquote");
    const notes = html.slice(html.indexOf(`<section class="footnotes"`));
    const first = notes.indexOf("First note");
    const second = notes.indexOf("Second note");
    assert.ok(first !== -1 && second !== -1, "both notes must be present");
    assert.ok(first < second, "notes must appear in source order");
    if (flavor === "epub") {
      assert.match(notes, /<section class="footnotes" epub:type="footnotes"/);
      assert.match(notes, /epub:type="footnote"/);
    } else {
      assert.match(notes, /<section class="footnotes" role="doc-endnotes"/);
      assert.match(notes, /role="doc-endnote"/);
    }
  });
}

test("strikethrough renders as semantic deleted text", () => {
  assert.equal(renderInlines([{ type: "strikeout", children: [{ type: "text", value: "old wording" }] }], context("web")), "<del>old wording</del>");
});
