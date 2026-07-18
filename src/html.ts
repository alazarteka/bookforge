import type { Asset, Block, Inline, OutputFlavor, Publication, Section } from "./model.js";
import { escapeHtml, inlineText } from "./util.js";

export interface HtmlContext {
  flavor: OutputFlavor;
  assets: Map<string, Asset>;
  chapterFile: (id: string) => string;
  assetPrefix: string;
}

export function renderInlines(inlines: Inline[], context: HtmlContext): string {
  return inlines.map((inline) => {
    switch (inline.type) {
      case "text": return escapeHtml(inline.value);
      case "space": return " ";
      case "softBreak": return "\n";
      case "lineBreak": return "<br />";
      case "emphasis": return `<em>${renderInlines(inline.children, context)}</em>`;
      case "strong": return `<strong>${renderInlines(inline.children, context)}</strong>`;
      case "code": return `<code>${escapeHtml(inline.value)}</code>`;
      case "link": {
        let href = inline.href;
        if (href.endsWith(".md")) href = `${context.chapterFile(href.replace(/^.*\//, "").replace(/\.md$/, ""))}`;
        return `<a href="${escapeHtml(href)}"${inline.title ? ` title="${escapeHtml(inline.title)}"` : ""}>${renderInlines(inline.children, context)}</a>`;
      }
      case "image": {
        const asset = inline.assetId ? context.assets.get(inline.assetId) : undefined;
        const src = asset ? `${context.assetPrefix}${asset.outputName}` : inline.src;
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(inlineText(inline.alt))}"${inline.title ? ` title="${escapeHtml(inline.title)}"` : ""} />`;
      }
      case "footnote": {
        const label = inline.id.split("-").at(-1) ?? "";
        const semantic = context.flavor === "epub" ? ` epub:type="noteref"` : ` role="doc-noteref"`;
        return `<a class="footnote-ref" id="${inline.id}-ref" href="#${inline.id}"${semantic}><sup>${escapeHtml(label)}</sup></a>`;
      }
    }
  }).join("");
}

export function renderBlocks(blocks: Block[], context: HtmlContext): string {
  return blocks.map((block) => {
    switch (block.type) {
      case "paragraph": return `<p>${renderInlines(block.children, context)}</p>`;
      case "heading": return `<h${block.level} id="${escapeHtml(block.id)}">${renderInlines(block.children, context)}</h${block.level}>`;
      case "blockquote": return `<blockquote>${renderBlocks(block.blocks, context)}</blockquote>`;
      case "sceneBreak": return `<hr class="scene-break" aria-label="Scene break" />`;
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : "";
        return `<${tag}${start}>${block.items.map((item) => `<li>${renderBlocks(item, context)}</li>`).join("")}</${tag}>`;
      }
      case "codeBlock": return `<pre${block.language ? ` data-language="${escapeHtml(block.language)}"` : ""}><code>${escapeHtml(block.value)}</code></pre>`;
      case "figure": return `<figure>${renderInlines([block.image], context)}<figcaption>${renderInlines(block.caption, context)}</figcaption></figure>`;
      case "table": return `<table>${block.headers.length ? `<thead><tr>${block.headers.map((cell) => `<th>${renderInlines(cell, context)}</th>`).join("")}</tr></thead>` : ""}<tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInlines(cell, context)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
  }).join("\n");
}

const collectFootnotes = (blocks: Block[]): Array<Extract<Inline, { type: "footnote" }>> => {
  const notes: Array<Extract<Inline, { type: "footnote" }>> = [];
  const scanInlines = (inlines: Inline[]) => inlines.forEach((inline) => {
    if (inline.type === "footnote") { notes.push(inline); scanBlocks(inline.blocks); }
    else if ("children" in inline && Array.isArray(inline.children)) scanInlines(inline.children);
  });
  const scanBlocks = (list: Block[]) => list.forEach((block) => {
    if (block.type === "paragraph" || block.type === "heading") scanInlines(block.children);
    else if (block.type === "blockquote") scanBlocks(block.blocks);
    else if (block.type === "list") block.items.forEach(scanBlocks);
    else if (block.type === "figure") { scanInlines([block.image]); scanInlines(block.caption); }
    else if (block.type === "table") { block.headers.forEach(scanInlines); block.rows.flat().forEach(scanInlines); }
  });
  scanBlocks(blocks);
  return notes;
};

const renderFootnotes = (notes: Array<Extract<Inline, { type: "footnote" }>>, context: HtmlContext): string => {
  if (!notes.length) return "";
  const sectionSemantic = context.flavor === "epub" ? ` epub:type="footnotes"` : ` role="doc-endnotes"`;
  const noteSemantic = context.flavor === "epub" ? ` epub:type="footnote"` : ` role="doc-endnote"`;
  return `\n<section class="footnotes"${sectionSemantic}><ol>${notes.map((note) => `<li id="${note.id}"${noteSemantic}>${renderBlocks(note.blocks, context)}<a href="#${note.id}-ref" aria-label="Back to reference">↩</a></li>`).join("")}</ol></section>`;
}

// Chapter openers show a numeral for body chapters and a part label for parts;
// front/back matter carry no kicker (their title stands alone). This replaces the
// old hard-coded "Chapter" word — redundant above titles like "Chapter I" — and the
// raw role string ("frontmatter") that used to leak onto the page.
export function sectionKickers(spine: Section[]): Map<string, string> {
  const kickers = new Map<string, string>();
  let chapter = 0;
  let part = 0;
  for (const section of spine) {
    if (section.role === "bodymatter") kickers.set(section.id, String(++chapter));
    else if (section.role === "part") kickers.set(section.id, `Part ${++part}`);
    else kickers.set(section.id, "");
  }
  return kickers;
}

// Human-readable role for the table of contents; body chapters get no tag.
export const roleLabels: Record<Section["role"], string> = {
  frontmatter: "Front matter",
  bodymatter: "",
  backmatter: "End matter",
  part: "Part",
};

export function sectionArticle(section: Section, publication: Publication, context: HtmlContext, kicker = ""): string {
  const header = `<header class="chapter-header">${kicker ? `<p class="chapter-kicker">${escapeHtml(kicker)}</p>` : ""}<h1>${renderInlines(section.title, context)}</h1></header>`;
  return `<article class="chapter ${section.role}" id="${escapeHtml(section.id)}">${header}<div class="prose">${renderBlocks(section.blocks, context)}${renderFootnotes(collectFootnotes(section.blocks), context)}</div></article>`;
}
