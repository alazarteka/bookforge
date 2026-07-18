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
  const footnotes: Array<Extract<Inline, { type: "footnote" }>> = [];
  const scan = (inlines: Inline[]) => inlines.forEach((inline) => {
    if (inline.type === "footnote") footnotes.push(inline);
    if ("children" in inline && Array.isArray(inline.children)) scan(inline.children);
  });
  const rendered = blocks.map((block) => {
    switch (block.type) {
      case "paragraph": scan(block.children); return `<p>${renderInlines(block.children, context)}</p>`;
      case "heading": scan(block.children); return `<h${block.level} id="${escapeHtml(block.id)}">${renderInlines(block.children, context)}</h${block.level}>`;
      case "blockquote": return `<blockquote>${renderBlocks(block.blocks, context)}</blockquote>`;
      case "sceneBreak": return `<hr class="scene-break" aria-label="Scene break" />`;
      case "list": {
        const tag = block.ordered ? "ol" : "ul";
        const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : "";
        return `<${tag}${start}>${block.items.map((item) => `<li>${renderBlocks(item, context)}</li>`).join("")}</${tag}>`;
      }
      case "codeBlock": return `<pre${block.language ? ` data-language="${escapeHtml(block.language)}"` : ""}><code>${escapeHtml(block.value)}</code></pre>`;
      case "figure": scan(block.caption); return `<figure>${renderInlines([block.image], context)}<figcaption>${renderInlines(block.caption, context)}</figcaption></figure>`;
      case "table": return `<table>${block.headers.length ? `<thead><tr>${block.headers.map((cell) => `<th>${renderInlines(cell, context)}</th>`).join("")}</tr></thead>` : ""}<tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInlines(cell, context)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
  }).join("\n");
  if (!footnotes.length) return rendered;
  const sectionSemantic = context.flavor === "epub" ? ` epub:type="footnotes"` : ` role="doc-endnotes"`;
  const noteSemantic = context.flavor === "epub" ? ` epub:type="footnote"` : ` role="doc-endnote"`;
  const notes = `<section class="footnotes"${sectionSemantic}><ol>${footnotes.map((note) => `<li id="${note.id}"${noteSemantic}>${renderBlocks(note.blocks, context)}<a href="#${note.id}-ref" aria-label="Back to reference">↩</a></li>`).join("")}</ol></section>`;
  return `${rendered}\n${notes}`;
}

export function sectionArticle(section: Section, publication: Publication, context: HtmlContext): string {
  return `<article class="chapter ${section.role}" id="${escapeHtml(section.id)}"><header class="chapter-header"><p class="chapter-kicker">${section.role === "bodymatter" ? "Chapter" : escapeHtml(section.role)}</p><h1>${renderInlines(section.title, context)}</h1></header><div class="prose">${renderBlocks(section.blocks, context)}</div></article>`;
}
