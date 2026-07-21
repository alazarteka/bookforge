import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Block, Inline, Section, SectionRole } from "./model.js";
import { inlineText, run, slugify } from "./util.js";

interface PandocNode { t: string; c?: unknown }
interface PandocDocument { "pandoc-api-version": number[]; meta: unknown; blocks: PandocNode[] }

export async function parseMarkdown(file: string, projectRoot: string, id: string, role: SectionRole, configuredTitle?: string): Promise<Section> {
  const source = await readFile(file, "utf8");
  const rawHtml = /^\s*<\/?[A-Za-z][^>]*>/m.exec(source);
  if (rawHtml?.index !== undefined) throw sourceError(file, source, rawHtml.index, "raw HTML is not supported; write literal angle-bracket text as inline code, for example `<option>`.");
  const remoteImage = /!\[[^\]]*\]\(https?:\/\//i.exec(source);
  if (remoteImage?.index !== undefined) throw sourceError(file, source, remoteImage.index, "remote images are not supported; download the image into this book project and link to the local file.");
  const result = await run("pandoc", [
    "--from=gfm+footnotes+attributes-raw_html+smart",
    "--to=json",
    "--wrap=none",
    file,
  ], { quiet: true });
  if (result.code !== 0) throw new Error(`Pandoc failed for ${id}: ${result.stderr.trim()}`);
  const document = JSON.parse(result.stdout) as PandocDocument;
  const state = { chapterId: id, projectRoot, sourceDirectory: path.dirname(file), headings: new Map<string, number>(), footnotes: 0 };
  const blocks = document.blocks.map((block) => adaptBlock(block, state));
  let title: Inline[] = configuredTitle ? [{ type: "text", value: configuredTitle }] : [{ type: "text", value: id }];
  let titleAnchor: string | undefined;
  if (!configuredTitle && blocks[0]?.type === "heading" && blocks[0].level === 1) {
    title = blocks[0].children;
    titleAnchor = blocks[0].id;
    blocks.shift();
  }
  const bodyHeadingLevels = blocks.filter((block): block is Extract<Block, { type: "heading" }> => block.type === "heading").map((block) => block.level);
  const shallowest = bodyHeadingLevels.length ? Math.min(...bodyHeadingLevels) : 2;
  const headingShift = Math.max(0, shallowest - 2);
  if (headingShift) for (const block of blocks) if (block.type === "heading") block.level -= headingShift;
  let previousHeading = 1;
  for (const block of blocks) {
    if (block.type !== "heading") continue;
    if (block.level > previousHeading + 1) throw new Error(`${id}: heading hierarchy jumps from level ${previousHeading} to ${block.level}`);
    previousHeading = block.level;
  }
  return { id, role, title, ...(titleAnchor ? { titleAnchor } : {}), blocks };
}

function adaptInlines(nodes: unknown, state: State): Inline[] {
  if (!Array.isArray(nodes)) throw new Error(`${state.chapterId}: malformed inline list`);
  return nodes.flatMap((raw) => {
    const node = raw as PandocNode;
    if (node.t === "Str") return { type: "text", value: String(node.c) } as Inline;
    if (node.t === "Space") return { type: "space" } as Inline;
    if (node.t === "SoftBreak") return { type: "softBreak" } as Inline;
    if (node.t === "LineBreak") return { type: "lineBreak" } as Inline;
    if (node.t === "Emph") return { type: "emphasis", children: adaptInlines(node.c, state) } as Inline;
    if (node.t === "Strong") return { type: "strong", children: adaptInlines(node.c, state) } as Inline;
    if (node.t === "Strikeout") return { type: "strikeout", children: adaptInlines(node.c, state) } as Inline;
    if (node.t === "Code") return { type: "code", value: String((node.c as unknown[])[1]) } as Inline;
    if (node.t === "Link") {
      const [, content, target] = node.c as [unknown, unknown, [string, string]];
      let [href, title] = target;
      const scheme = href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
      if (href.startsWith("//") || (scheme && !safeLinkSchemes.has(scheme))) throw new Error(`${state.chapterId}: unsafe link protocol`);
      if (!scheme && !href.startsWith("#")) {
        const [targetPath, fragment] = href.split("#", 2);
        if (targetPath && /\.md$/i.test(targetPath)) href = `${path.relative(state.projectRoot, path.resolve(state.sourceDirectory, targetPath))}${fragment ? `#${fragment}` : ""}`;
      }
      return { type: "link", href, ...(title ? { title } : {}), children: adaptInlines(content, state) } as Inline;
    }
    if (node.t === "Image") {
      const [, alt, target] = node.c as [unknown, unknown, [string, string]];
      let [src, title] = target;
      if (/^[a-z]+:\/\//i.test(src) || src.startsWith("data:")) throw new Error(`${state.chapterId}: remote or embedded images are not supported`);
      src = path.relative(state.projectRoot, path.resolve(state.sourceDirectory, src));
      const altInlines = adaptInlines(alt, state);
      if (!inlineText(altInlines).trim()) throw new Error(`${state.chapterId}: images require alternative text`);
      return { type: "image", src, alt: altInlines, ...(title ? { title } : {}) } as Inline;
    }
    if (node.t === "Note") {
      const footnote = ++state.footnotes;
      return { type: "footnote", id: `${state.chapterId}-fn-${footnote}`, blocks: adaptBlocks(node.c, state) } as Inline;
    }
    if (node.t === "Quoted") {
      // `smart` parsing emits Quoted nodes; render the curly marks as plain text
      // around the (possibly rich) contents. A neutral expansion — never emphasis,
      // which would silently italicize every quotation.
      const [quoteType, content] = node.c as [PandocNode, unknown];
      const marks = quoteType.t === "SingleQuote" ? ["‘", "’"] : ["“", "”"];
      return [{ type: "text", value: marks[0] }, ...adaptInlines(content, state), { type: "text", value: marks[1] }] as Inline[];
    }
    throw new Error(`${state.chapterId}: unsupported Markdown inline construct ${node.t}. See https://github.com/alazarteka/bookforge/blob/main/docs/MARKDOWN.md`);
  });
}

const safeLinkSchemes = new Set(["http", "https", "mailto", "tel"]);

interface State { chapterId: string; projectRoot: string; sourceDirectory: string; headings: Map<string, number>; footnotes: number }

function sourceError(file: string, source: string, offset: number, message: string): Error {
  const before = source.slice(0, offset);
  const line = before.split("\n").length;
  const column = offset - before.lastIndexOf("\n");
  return new Error(`${file}:${line}:${column}: ${message}`);
}

function adaptBlocks(nodes: unknown, state: State): Block[] {
  if (!Array.isArray(nodes)) throw new Error(`${state.chapterId}: malformed block list`);
  return nodes.map((node) => adaptBlock(node as PandocNode, state));
}

function adaptBlock(node: PandocNode, state: State): Block {
  if (node.t === "Para" || node.t === "Plain") {
    const children = adaptInlines(node.c, state);
    if (children.length === 1 && children[0]?.type === "image") {
      return { type: "figure", image: children[0], caption: children[0].alt };
    }
    return { type: "paragraph", children };
  }
  if (node.t === "Header") {
    const [level, attr, content] = node.c as [number, [string, string[], unknown], unknown];
    const children = adaptInlines(content, state);
    const explicit = attr[0];
    const base = explicit || slugify(inlineText(children));
    const count = (state.headings.get(base) ?? 0) + 1;
    state.headings.set(base, count);
    return { type: "heading", level, id: `${state.chapterId}--${base}${count > 1 ? `-${count}` : ""}`, children };
  }
  if (node.t === "BlockQuote") return { type: "blockquote", blocks: adaptBlocks(node.c, state) };
  if (node.t === "HorizontalRule") return { type: "sceneBreak" };
  if (node.t === "BulletList") {
    return { type: "list", ordered: false, start: 1, items: (node.c as unknown[]).map((item) => adaptBlocks(item, state)) };
  }
  if (node.t === "OrderedList") {
    const [attributes, items] = node.c as [[number, unknown, unknown], unknown[]];
    return { type: "list", ordered: true, start: attributes[0], items: items.map((item) => adaptBlocks(item, state)) };
  }
  if (node.t === "CodeBlock") {
    const [attr, value] = node.c as [[string, string[], unknown], string];
    return { type: "codeBlock", ...(attr[1][0] ? { language: attr[1][0] } : {}), value };
  }
  if (node.t === "Table") return adaptTable(node.c, state);
  throw new Error(`${state.chapterId}: unsupported block construct ${node.t}`);
}

/** Exposed for unit tests of fail-closed table adaptation. */
export function adaptTableShape(value: unknown, chapterId = "chapter"): Block {
  return adaptTable(value, {
    chapterId,
    projectRoot: ".",
    sourceDirectory: ".",
    headings: new Map(),
    footnotes: 0,
  });
}

function adaptTable(value: unknown, state: State): Block {
  if (!Array.isArray(value) || value.length < 5) throw new Error(`${state.chapterId}: malformed table`);
  const head = value[3];
  const bodies = value[4];
  if (!Array.isArray(head) || !Array.isArray(head[1])) throw new Error(`${state.chapterId}: malformed table head`);
  if (!Array.isArray(bodies)) throw new Error(`${state.chapterId}: malformed table body`);
  const cellInlines = (cell: unknown): Inline[] => {
    if (!Array.isArray(cell) || cell.length < 5) throw new Error(`${state.chapterId}: malformed table cell`);
    const rowSpan = cell[2];
    const colSpan = cell[3];
    const blocks = cell[4];
    if (rowSpan !== 1 || colSpan !== 1) throw new Error(`${state.chapterId}: spanning table cells are not supported`);
    if (!Array.isArray(blocks)) throw new Error(`${state.chapterId}: malformed table cell`);
    const adapted = adaptBlocks(blocks, state);
    const first = adapted[0];
    if (adapted.length !== 1 || first?.type !== "paragraph") throw new Error(`${state.chapterId}: table cells must contain one simple paragraph`);
    return first.children;
  };
  const rowCells = (row: unknown): Inline[][] => {
    if (!Array.isArray(row) || !Array.isArray(row[1])) throw new Error(`${state.chapterId}: malformed table row`);
    return row[1].map(cellInlines);
  };
  const headerRows = head[1] as unknown[];
  const headers = headerRows[0] ? rowCells(headerRows[0]) : [];
  const rows = (bodies as unknown[]).flatMap((body) => {
    if (!Array.isArray(body) || !Array.isArray(body[2]) || !Array.isArray(body[3])) {
      throw new Error(`${state.chapterId}: malformed table body`);
    }
    return [...body[2], ...body[3]];
  }).map(rowCells);
  return { type: "table", headers, rows };
}
