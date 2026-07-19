import type { Asset, Block, Inline, OutputFlavor, Publication, Section } from "./model.js";
import { visitBlocks } from "./traversal.js";
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
      case "strikeout": return `<del>${renderInlines(inline.children, context)}</del>`;
      case "code": return `<code>${escapeHtml(inline.value)}</code>`;
      case "link": {
        let href = inline.href;
        const chapter = href.match(/^([a-z0-9][a-z0-9._-]*)\.md(?:#(.*))?$/i);
        if (chapter) {
          const destination = context.chapterFile(chapter[1]!);
          href = chapter[2] === undefined ? destination : destination.startsWith("#") ? `#${chapter[2]}` : `${destination}#${chapter[2]}`;
        }
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
  visitBlocks(blocks, {
    inline: (inline) => {
      if (inline.type === "footnote") notes.push(inline);
    },
  });
  return notes;
};

const renderFootnotes = (notes: Array<Extract<Inline, { type: "footnote" }>>, context: HtmlContext): string => {
  if (!notes.length) return "";
  const sectionSemantic = context.flavor === "epub" ? ` epub:type="footnotes"` : ` role="doc-endnotes"`;
  const noteSemantic = context.flavor === "epub" ? ` epub:type="footnote"` : ` role="doc-endnote"`;
  // A drawn return arrow (not the ↩ glyph) so footnotes need no symbol font in any format.
  const backArrow = `<svg xmlns="http://www.w3.org/2000/svg" class="fn-back" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M13 4v3.4a2 2 0 0 1-2 2H4" /><path d="M6.4 7 3.8 9.4l2.6 2.5" /></svg>`;
  return `\n<section class="footnotes"${sectionSemantic}><ol>${notes.map((note) => {
    const backLink = `<a class="footnote-back" href="#${note.id}-ref" aria-label="Back to reference">${backArrow}</a>`;
    // Flow the back-link into the last paragraph so it trails the text inline rather
    // than dropping onto its own line (works even where CSS is ignored).
    const last = note.blocks.at(-1);
    const body = last && last.type === "paragraph"
      ? `${renderBlocks(note.blocks.slice(0, -1), context)}<p>${renderInlines(last.children, context)}${backLink}</p>`
      : `${renderBlocks(note.blocks, context)}${backLink}`;
    return `<li id="${note.id}"${noteSemantic}>${body}</li>`;
  }).join("")}</ol></section>`;
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

// The typographic cover, shared by web and EPUB so both formats present the same mark.
export function coverMarkup(publication: Publication): string {
  const { title, subtitle, authors } = publication.metadata;
  return `<section class="cover" id="top"><div class="cover-inner"><div class="sigil" aria-hidden="true"></div><p class="cover-label">A Bookforge edition</p><h1 class="cover-title">${escapeHtml(title)}</h1>${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}</p>` : ""}<p class="authors">${authors.map(escapeHtml).join(" · ")}</p></div></section>`;
}

// A title that already names its own number ("Chapter I", "Part 2", "IV.") makes the
// numeral kicker redundant on the opener — suppress it there. The TOC still shows the number.
function titleSelfNumbers(title: Inline[]): boolean {
  const text = inlineText(title).trim();
  return /^(chapter|part)\s/i.test(text) || /^[ivxlcdm]+\.?\s*$/i.test(text) || /^\d+\.?\s/.test(text);
}

export function sectionArticle(section: Section, publication: Publication, context: HtmlContext, kicker = ""): string {
  const showKicker = kicker && !titleSelfNumbers(section.title);
  const header = `<header class="chapter-header">${showKicker ? `<p class="chapter-kicker">${escapeHtml(kicker)}</p>` : ""}<h1${section.titleAnchor ? ` id="${escapeHtml(section.titleAnchor)}"` : ""}>${renderInlines(section.title, context)}</h1></header>`;
  // Suppress the drop cap when the chapter opens on non-letter punctuation (a quote or
  // dash) — CSS ::first-letter would otherwise enlarge the punctuation mark.
  const first = section.blocks[0];
  let prose: string;
  if (first?.type === "paragraph") {
    const opening = inlineText(first.children).trim();
    const noDrop = opening.length > 0 && !/^\p{L}/u.test(opening);
    prose = noDrop
      ? `<p class="no-drop">${renderInlines(first.children, context)}</p>\n${renderBlocks(section.blocks.slice(1), context)}`
      : renderBlocks(section.blocks, context);
  } else {
    prose = renderBlocks(section.blocks, context);
  }
  return `<article class="chapter ${section.role}" id="${escapeHtml(section.id)}">${header}<div class="prose">${prose}${renderFootnotes(collectFootnotes(section.blocks), context)}</div></article>`;
}
