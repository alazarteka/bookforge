import assert from "node:assert/strict";
import test from "node:test";
import type { Publication } from "./model.js";
import { visitPublication } from "./traversal.js";

const publication: Publication = {
  schemaVersion: 1,
  id: "book",
  metadata: { title: "Test", language: "en", authors: ["Author"] },
  assets: [],
  spine: [{
    id: "chapter",
    role: "bodymatter",
    title: [{ type: "text", value: "Title" }],
    layout: "prose",
    blocks: [{
      type: "paragraph",
      children: [
        { type: "text", value: "Before" },
        { type: "footnote", id: "chapter-fn-1", blocks: [{
          type: "blockquote",
          blocks: [{ type: "paragraph", children: [{ type: "image", src: "nested.png", alt: [{ type: "text", value: "Nested" }] }] }],
        }] },
      ],
    }, {
      type: "figure",
      image: { type: "image", src: "figure.png", alt: [{ type: "text", value: "Figure" }] },
      caption: [{ type: "text", value: "Caption" }],
    }],
  }],
};

test("traversal visits titles and nested IR nodes in source order", () => {
  const seen: string[] = [];
  visitPublication(publication, {
    block: (block, context) => seen.push(`block:${context.section?.id}:${block.type}`),
    inline: (inline, context) => seen.push(`inline:${context.section?.id}:${inline.type}`),
  });
  assert.deepEqual(seen, [
    "inline:chapter:text",
    "block:chapter:paragraph",
    "inline:chapter:text",
    "inline:chapter:footnote",
    "block:chapter:blockquote",
    "block:chapter:paragraph",
    "inline:chapter:image",
    "block:chapter:figure",
    "inline:chapter:image",
    "inline:chapter:text",
  ]);
});

test("traversal can omit section titles for body-only analyses", () => {
  const seen: string[] = [];
  visitPublication(publication, { inline: (inline) => seen.push(inline.type) }, { includeTitles: false });
  assert.deepEqual(seen, ["text", "footnote", "image", "image", "text"]);
});
